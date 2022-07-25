import * as vscode from 'vscode';
import { Auth0AuthenticationProvider, AUTH_TYPE } from './authProvider';
import Ktime from './ktime';

var ktime: Ktime;

export async function activate(context: vscode.ExtensionContext) {
	const subscriptions = context.subscriptions;

	// subscriptions.push(
	// 	new AzureADAuthenticationProvider(context)
	// );

	const authprovider = new Auth0AuthenticationProvider(context);

	subscriptions.push(
		authprovider
	);

	ktime = new Ktime(authprovider);

	// getSession();
	// getMsSession();
	// getMsDefaultSession();

	getAuth0Session();

	subscriptions.push(
		vscode.authentication.onDidChangeSessions(async e => {
			console.log(e);

			if (e.provider.id === AUTH_TYPE) {
				getSession();
			} else if (e.provider.id === "auth0") {
				getAuth0Session();
			}
		})
	);

	ktime.initialize();
}

const getAuth0Session = async () => {
	const session = await vscode.authentication.getSession("auth0", [], { createIfNone: false });
	if (session) {
		vscode.window.showInformationMessage(`Welcome back ${session.account.label}`);
	}
};

const getSession = async () => {
	const session = await vscode.authentication.getSession(AUTH_TYPE, [], { createIfNone: false });
	if (session) {
		vscode.window.showInformationMessage(`Welcome back ${session.account.label}`);
	}
};

const getMsSession = async () => {
	const session = await vscode.authentication.getSession('microsoft', [
		"VSCODE_CLIENT_ID:f3164c21-b4ca-416c-915c-299458eba95b",
		"VSCODE_TENANT:common",
		"https://graph.microsoft.com/User.Read"
	], { createIfNone: false });

	if (session) {
		vscode.window.showInformationMessage(`Welcome back ${session.account.label}`);
	}
};

const getMsDefaultSession = async () => {
	const session = await vscode.authentication.getSession('microsoft', [
		"https://graph.microsoft.com/User.Read",
		"https://graph.microsoft.com/Calendar.Read"
	], { createIfNone: false });

	if (session) {
		vscode.window.showInformationMessage(`Welcome back ${session.account.label}`);
	}
};

// this method is called when your extension is deactivated
export function deactivate() { }