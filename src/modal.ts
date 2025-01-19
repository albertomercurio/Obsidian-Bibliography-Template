import { App, Modal } from 'obsidian';

export class InputDOIModal extends Modal {
    private callback: (value: string) => void;
    private placeholder: string;

    constructor(app: App, placeholder: string, callback: (value: string) => void) {
        super(app);
        this.placeholder = placeholder;
        this.callback = callback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: this.placeholder });
    
        const container = contentEl.createEl("div", { cls: "doi-container" });
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.alignItems = "center";
        container.style.justifyContent = "center";
        container.style.width = "100%";
        container.style.padding = "20px";
        container.style.boxSizing = "border-box";
    
        const input = container.createEl("input", { type: "text" });
        input.style.width = "100%";
        input.style.marginBottom = "10px";
        input.style.padding = "10px";
        input.style.border = "1px solid #ccc";
        input.style.borderRadius = "4px";
        input.focus();
    
        const submitButton = container.createEl("button", { text: "Submit" });
        // submitButton.style.backgroundColor = "#007bff";
        // submitButton.style.color = "#fff";
        submitButton.style.border = "none";
        submitButton.style.padding = "10px 20px";
        submitButton.style.borderRadius = "4px";
        submitButton.style.cursor = "pointer";
        submitButton.onclick = () => {
            this.callback(input.value.trim());
            this.close();
        };
    
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                this.callback(input.value.trim());
                this.close();
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}