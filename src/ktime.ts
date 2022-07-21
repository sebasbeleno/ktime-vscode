import * as vscode from 'vscode';

class Ktime {

    private lastFile: string = "";
    private lastHeartbeat: number = 0;

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

                        this.sendHeartBeat(time, file);
                        // TODO: Heartbeat
                        this.lastFile = file;
                        this.lastHeartbeat = time;
                    }
                }
            }
        }
    }

    private enoughTimePassed(time: number): boolean {
        return this.lastHeartbeat + 120000 < time;
    }

    private sendHeartBeat(time: number, file: string) {
        const timeSpend = time - this.lastHeartbeat;

        console.log(`Heartbeat: ${timeSpend}ms`);
        console.log(`File: ${file}`);
    }
}

export default Ktime;
