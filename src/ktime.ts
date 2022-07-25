import fetch from 'node-fetch';
import * as vscode from 'vscode';
import { Auth0AuthenticationProvider } from './authProvider';

class Ktime {

    private lastFile: string = vscode.window.activeTextEditor?.document.fileName || '';
    private lastHeartbeat: number = Date.now();
    private lastLanguage: string = vscode.window.activeTextEditor?.document.languageId || '';
    private AuthProvider: Auth0AuthenticationProvider;

    constructor(AuthProvider: Auth0AuthenticationProvider) {
        console.log("Ktime initialized");
        this.AuthProvider = AuthProvider;
    }

    /**
     * initialize the extension
     */
    public initialize() {
        this.initializeEventsListeners();
    }

    private async initializeEventsListeners() {
        let subscriptions: vscode.Disposable[] = [];

        vscode.window.onDidChangeActiveTextEditor(this.onChange, this, subscriptions);
    }


    private onChange(): void {
        this.onEvent(false);
    }

    private onEvent(write: boolean): void {
        if (write) {
            return;
        }

        let editor = vscode.window.activeTextEditor;

        if (editor) {
            let doc = editor.document;

            if (doc) {
                let file = doc.fileName;

                if (file) {
                    let time: number = Date.now();

                    if (this.enoughTimePassed(time)) {
                        if (write || this.lastFile !== file) {
                            this.sendHeartBeat(time, this.lastFile, this.lastLanguage).then(() => {
                                // TODO: Heartbeat
                                this.lastFile = file;
                                this.lastHeartbeat = time;
                                this.lastLanguage = doc.languageId;
                            });
                        }
                    }
                }
            }
        }
    }

    private enoughTimePassed(time: number): boolean {
        console.log(`Last heartbeat: ${this.lastHeartbeat}`);
        console.log(`Current time: ${time}`);

        console.log(`Time passed: ${time - this.lastHeartbeat}`);

        return time - this.lastHeartbeat > 10000;
    }

    private getCurrentFolderName(): string {
        let folder = vscode.workspace.workspaceFolders;
        if (folder) {
            return folder[0].name;
        }
        return "";
    }

    private async sendHeartBeat(time: number, file: string, language: string): Promise<void> {
        await this.AuthProvider.checkAccestToken();

        const timeSpend = time - this.lastHeartbeat;
        const uri = 'http://localhost:3000/api/heartbeat';
        var dateObj = new Date();
        const body = {
            timeSpend: timeSpend,
            filePath: file.toString(),
            language: language,
            projectFolder: this.getCurrentFolderName(),
            date: this.formatDate(dateObj)
        };
        const accessToken = await this.AuthProvider.getLocalAccessToken();


        fetch(uri, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + accessToken
            }
        }).then(async res => {
            const status = res.status;

            console.log(status);
        }).catch(async err => {
            console.log(err)
        }).finally(() => {
            console.log('finally');
        });


        console.log(`Heartbeat: ${timeSpend}ms`);
        console.log(`File: ${file}`);
    }

    private formatDate(date: Date): string {
        var d = new Date(date),
            month = '' + (d.getMonth() + 1),
            day = '' + d.getDate(),
            year = d.getFullYear();

        if (month.length < 2) {
            month = '0' + month;
        }

        if (day.length < 2) {
            day = '0' + day;
        }

        return [year, month, day].join('-');
    }

}

export default Ktime;
