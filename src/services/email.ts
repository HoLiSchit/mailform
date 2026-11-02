import {File as FormidableFile, Files as FormidableFiles} from "formidable";
import nodemailer, {Transporter} from "nodemailer";
import Mail from "nodemailer/lib/mailer";
import fs from "fs";
import {Attachment as NodemailerAttachment} from "nodemailer/lib/mailer";
import {TargetManager} from "./targetManager";
import {Target} from "../@types/target";

export class EmailService {

    private static targetTransports: Map<string, Transporter> = new Map<string, Transporter>();

    /**
     * Create a transport for a SMTP URL without registering it
     */
    public static createTransport(smtpURL: string): Transporter {
        return nodemailer.createTransport(smtpURL);
    }

    /**
     * Replace all registered transports at once and close the old ones (used when targets are reloaded)
     */
    public static replace(transports: Map<string, Transporter>): void {
        const old = this.targetTransports;
        this.targetTransports = transports;
        old.forEach((transport) => transport.close());
    }

    /**
     * Map file objects from formidable to attachment objects for nodemailer
     * @param files Formidable files
     * @return NodemailerAttachment[]
     */
    private static mapFormidableFilesToNodemailerAttachments(files: FormidableFiles): NodemailerAttachment[] {
        const attachments: NodemailerAttachment[] = [];

        for (const fileKey in files) {
            const fileValue = files[fileKey];
            const fileValues: FormidableFile[] = fileValue instanceof Array ? fileValue : [fileValue]

            for (const singleFileValue of fileValues) {
                attachments.push(this.mapFormidableFileToNodemailerAttachment(singleFileValue));
            }
        }
        return attachments;
    }

    /**
     * Map file object from formidable to attachment object for nodemailer
     * @param file Formidable file
     * @return NodemailerAttachment
     */
    private static mapFormidableFileToNodemailerAttachment(file: FormidableFile): NodemailerAttachment {
        return {
            path: file.filepath,
            filename: file.originalFilename,
            contentType: file.mimetype,
        };
    }

    /**
     * Build an address object for an email "from"/"reply-to" field with an optional display name.
     * The display name comes from the visitor, so characters that could fake a second address are removed.
     * @param address Email address
     * @param firstName
     * @param lastName
     * @return Mail.Address
     */
    public static formatFromField(address: string, firstName: string = null, lastName: string = null): Mail.Address {

        const name = [firstName, lastName]
            .filter((part) => !!part)
            .join(" ")
            .replace(/[<>"@\r\n,;]/g, "")
            .trim();

        return { name, address };

    }

    /**
     * Send an email
     * @param targetName (file-)name of an existing and loaded target
     * @param from Email from field
     * @param replyTo Email Reply-To field
     * @param subject Email subject field
     * @param body Email body
     * @param files Formidable files
     * @return Promise<boolean|Error> True if success, error object if not success
     */
    public static async sendMail(targetName: string, from: Mail.Address, replyTo: Mail.Address, subject: string, body: string, files: FormidableFiles): Promise<boolean|Error> {

        if(!this.targetTransports.has(targetName)) return false;

        let target: Target = TargetManager.targets.get(targetName);

        let transporter: Transporter = this.targetTransports.get(targetName);

        try {
            // Der Body kommt vom Besucher. Ohne `allowHtml` wird er als reiner Text versendet,
            // damit weder fremdes HTML dargestellt wird noch Zeilenumbrüche verloren gehen.
            await transporter.sendMail({
                from,
                replyTo,
                to: target.recipients,
                subject,
                ...(target.allowHtml ? { html: body } : { text: body }),
                attachments: this.mapFormidableFilesToNodemailerAttachments(files),
            });
        } catch (e) {
            console.error("[!] An error occurred while sending an email");
            console.error("* target: " + targetName);
            console.error("* " + e.message);
            return e;
        }

        console.log(`Email successful sent`);
        console.log("* target: " + targetName);
        console.log("* time: " + new Date().toString());

        return true;

    }

    /**
     * Delete the temporary files formidable wrote to disk
     * @param files Formidable files
     */
    public static removeTempFiles(files: FormidableFiles): void {
        for (const fileKey in files) {
            const fileValue = files[fileKey];
            const fileValues: FormidableFile[] = fileValue instanceof Array ? fileValue : [fileValue];

            for (const file of fileValues) {
                if (file?.filepath) fs.unlink(file.filepath, () => {});
            }
        }
    }

}
