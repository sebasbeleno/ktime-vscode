import fetch from 'node-fetch';
import * as vscode from 'vscode';

class Ktime {

    private lastFile: string = vscode.window.activeTextEditor?.document.fileName || '';
    private lastHeartbeat: number = Date.now();
    private lastLanguage: string = vscode.window.activeTextEditor?.document.languageId || '';

    constructor() {
        console.log("Ktime initialized");

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

                    if (write || this.enoughTimePassed(time) || this.lastFile !== file) {

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

    private enoughTimePassed(time: number): boolean {
        return this.lastHeartbeat + 120000 < time;
    }

    private getCurrentFolderName(): string {
        let folder = vscode.workspace.workspaceFolders;
        if (folder) {
            return folder[0].name;
        }
        return "";
    }

    private async sendHeartBeat(time: number, file: string, language: string) {
        const timeSpend = time - this.lastHeartbeat;

        const uri = 'http://localhost:3000/api/heartbeat';

        const body = {
            timeSpend: timeSpend,
            filePath: file.toString(),
            language: language,
            projectFolder: this.getCurrentFolderName()
        };

        const session = await vscode.authentication.getSession('auth0', [], { createIfNone: false });
        if (session) {
            const token = session.accessToken;
            fetch(uri, {
                method: 'POST',
                body: JSON.stringify(body),
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + token
                }
            }).then(res => {
                const status = res.status;

                console.log(status);
            }).catch(err => {
                console.log(err);
            }).finally(() => {
                console.log('finally');
            });
        } else {
            console.log("No session");
        }


        console.log(`Heartbeat: ${timeSpend}ms`);
        console.log(`File: ${file}`);
    }
}

export default Ktime;
