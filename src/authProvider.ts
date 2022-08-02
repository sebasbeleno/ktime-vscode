import axios from 'axios';
import fetch from 'node-fetch';
import { v4 as uuid } from 'uuid';
import { authentication, AuthenticationProvider, AuthenticationProviderAuthenticationSessionsChangeEvent, AuthenticationSession, Disposable, env, EventEmitter, ExtensionContext, ProgressLocation, Uri, UriHandler, window } from "vscode";
import { PromiseAdapter, promiseFromEvent } from "./utils";

export const AUTH_TYPE = `auth0`;
const AUTH_NAME = `Ktime`;
const CLIENT_ID = process.env.AUTH0_CLIENT_ID as string;
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN as string;
const SESSIONS_SECRET_KEY = `${AUTH_TYPE}`;

class UriEventHandler extends EventEmitter<Uri> implements UriHandler {
    public handleUri(uri: Uri) {
        this.fire(uri);
    }
}

export class Auth0AuthenticationProvider implements AuthenticationProvider, Disposable {
    private _sessionChangeEmitter = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
    private _disposable: Disposable;
    private _pendingStates: string[] = [];
    private _codeExchangePromises = new Map<string, { promise: Promise<{}>; cancel: EventEmitter<void> }>();
    private _uriHandler = new UriEventHandler();

    constructor(private readonly context: ExtensionContext) {
        this._disposable = Disposable.from(
            authentication.registerAuthenticationProvider(AUTH_TYPE, AUTH_NAME, this, { supportsMultipleAccounts: false }),
            window.registerUriHandler(this._uriHandler)
        );
    }

    get onDidChangeSessions() {
        return this._sessionChangeEmitter.event;
    }

    get redirectUri() {
        const publisher = this.context.extension.packageJSON.publisher;
        const name = this.context.extension.packageJSON.name;
        return `${env.uriScheme}://${publisher}.${name}`;
    }

    /**
     * Get the existing sessions
     * @param scopes
     * @returns
     */
    public async getSessions(scopes?: string[]): Promise<readonly AuthenticationSession[]> {
        const allSessions = await this.context.secrets.get(SESSIONS_SECRET_KEY);
        const authcode = await this.context.secrets.get(`${SESSIONS_SECRET_KEY}.code`);

        if (allSessions) {
            return JSON.parse(allSessions) as AuthenticationSession[];
        }

        return [];
    }

    /**
     * Create a new auth session
     * @param scopes
     * @returns
     */
    public async createSession(scopes: string[]): Promise<AuthenticationSession> {
        try {
            const token = await this.login(scopes);

            if (!token) {
                throw new Error(`Auth0 login failure`);
            }

            const userinfo: { name: string, email: string } = await this.getUserInfo(token.access_token) as { name: string, email: string };

            const session: AuthenticationSession = {
                id: uuid(),
                accessToken: token.access_token,
                account: {
                    label: userinfo.name,
                    id: userinfo.email
                },
                scopes: ['offline_access']
            };

            await this.context.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify([session]));
            await this.context.secrets.store(`${SESSIONS_SECRET_KEY}.code`, token.authorization_code);
            await this.context.secrets.store(`${SESSIONS_SECRET_KEY}.access`, token.access_token);
            this._sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] });

            const refreshToken = await this.getRefreshToken();
            if (refreshToken) {
                await this.context.secrets.store(`${SESSIONS_SECRET_KEY}.refresh`, refreshToken.refresh_token);
            }
            return session;
        } catch (e) {
            window.showErrorMessage(`Sign in failed: ${e}`);
            throw e;
        }
    }

    /**
     * Remove an existing session
     * @param sessionId
     */
    public async removeSession(sessionId: string): Promise<void> {
        const allSessions = await this.context.secrets.get(SESSIONS_SECRET_KEY);
        if (allSessions) {
            let sessions = JSON.parse(allSessions) as AuthenticationSession[];
            const sessionIdx = sessions.findIndex(s => s.id === sessionId);
            const session = sessions[sessionIdx];
            sessions.splice(sessionIdx, 1);

            await this.context.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify(sessions));

            if (session) {
                this._sessionChangeEmitter.fire({ added: [], removed: [session], changed: [] });
            }
        }
    }

    /**
     * Dispose the registered services
     */
    public async dispose() {
        this._disposable.dispose();
    }

    /**
     * Log in to Auth0
     */
    private async login(scopes: string[] = []) {
        return await window.withProgress<{ access_token: string, authorization_code: string }>({
            location: ProgressLocation.Notification,
            title: "Signing in to Auth0...",
            cancellable: true
        }, async (_, token) => {
            const stateId = uuid();

            this._pendingStates.push(stateId);

            const scopeString = scopes.join(' ');

            if (!scopes.includes('openid')) {
                scopes.push('openid');
            }
            if (!scopes.includes('profile')) {
                scopes.push('profile');
            }
            if (!scopes.includes('email')) {
                scopes.push('email');
            }
            if (!scopes.includes('offline_access')) {
                scopes.push('offline_access');
            }

            const searchParams = new URLSearchParams([
                ['response_type', "code token"],
                ['audience', `ktimeapi`],
                ['client_id', CLIENT_ID],
                ['redirect_uri', this.redirectUri],
                ['state', stateId],
                ['scope', scopes.join(' ')],
                ['prompt', "login"]
            ]);
            const uri = Uri.parse(`https://${AUTH0_DOMAIN}/authorize?${searchParams.toString()}`);
            await env.openExternal(uri);

            let codeExchangePromise = this._codeExchangePromises.get(scopeString);
            if (!codeExchangePromise) {
                codeExchangePromise = promiseFromEvent(this._uriHandler.event, this.handleUri(scopes));
                this._codeExchangePromises.set(scopeString, codeExchangePromise);
            }

            try {
                return await Promise.race([
                    codeExchangePromise.promise,
                    new Promise<{}>((_, reject) => setTimeout(() => reject('Cancelled'), 60000)),
                    promiseFromEvent<any, any>(token.onCancellationRequested, (_, __, reject) => { reject('User Cancelled'); }).promise
                ]);
            } finally {
                this._pendingStates = this._pendingStates.filter(n => n !== stateId);
                codeExchangePromise?.cancel.fire();
                this._codeExchangePromises.delete(scopeString);
            }
        });
    }

    /**
     * Handle the redirect to VS Code (after sign in from Auth0)
     * @param scopes
     * @returns
     */
    private handleUri: (scopes: readonly string[]) => PromiseAdapter<Uri, {}> =
        (scopes) => async (uri, resolve, reject) => {
            const query = new URLSearchParams(uri.fragment);
            const access_token = query.get('access_token');
            const authorization_code = query.get('code');

            const state = query.get('state');

            if (!access_token) {
                reject(new Error('No token'));
                return;
            }
            if (!state) {
                reject(new Error('No state'));
                return;
            }

            if (!authorization_code) {
                reject(new Error('No code'));
                return;
            }

            // Check if it is a valid auth request started by the extension
            if (!this._pendingStates.some(n => n === state)) {
                reject(new Error('State not found'));
                return;
            }

            resolve({ authorization_code, access_token });
        };

    /**
     * Get the user info from Auth0
     * @param token
     * @returns
     */
    private async getUserInfo(token: string) {
        const response = await fetch(`https://${AUTH0_DOMAIN}/userinfo`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        if (response.status === 200) {
            return await response.json();
        } else {
            return null;
        }
    }

    private async getRefreshToken() {
        const authCode = await this.context.secrets.get(`${SESSIONS_SECRET_KEY}.code`);

        var options = {
            method: 'POST',
            url: `https://${AUTH0_DOMAIN}/oauth/token`,
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            data: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: CLIENT_ID as string,
                client_secret: process.env.AUTH0_CLIENT_SECRET as string,
                code: authCode as string,
                redirect_uri: 'vscode://sebasbeleno.ktime'
            })
        };

        return axios.request(options).then(function (response) {
            if (response.status === 200) {
                return response.data;
            } else {
                return null;
            }
        }).catch(function (error: any) {
            return null;
        });
    }

    private async refreshAccessToken(refreshToken: string) {
        var options = {
            method: 'POST',
            url: `https://${AUTH0_DOMAIN}/oauth/token`,
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            data: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: CLIENT_ID as string,
                client_secret: process.env.AUTH0_CLIENT_SECRET as string,
                refresh_token: refreshToken as string
            })
        };

        return axios.request(options).then(function (response) {
            const data = response.data;

            return data;
        }).catch(function (error: any) {
            return null;
        });
    }

    async checkAccestToken() {
        const accessToken = await this.context.secrets.get(`${SESSIONS_SECRET_KEY}.access`);

        if (accessToken) {
            const userInfo = await this.getUserInfo(accessToken);

            if (userInfo) {
                return userInfo;
            }

            // use the refersh token to get a new access token
            const refreshToken = await this.context.secrets.get(`${SESSIONS_SECRET_KEY}.refresh`);

            if (refreshToken) {
                const access_token = await this.refreshAccessToken(refreshToken);

                if (access_token) {
                    await this.context.secrets.delete(`${SESSIONS_SECRET_KEY}.access`);
                    await this.context.secrets.store(`${SESSIONS_SECRET_KEY}.access`, access_token.access_token);
                }
            }

        } else {

        }
    }

    async getLocalAccessToken() {
        return await this.context.secrets.get(`${SESSIONS_SECRET_KEY}.access`);
    }
}