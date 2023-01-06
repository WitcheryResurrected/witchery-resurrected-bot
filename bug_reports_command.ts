import {SlashCommandBuilder, SlashCommandStringOption, SlashCommandSubcommandBuilder} from '@discordjs/builders'

import fs from 'fs'
import {ChatInputCommandInteraction, Client, TextChannel} from "discord.js";
import {getConfig} from "./config";

export default async (client: Client, lock) => {
    const {bugReportsChannel} = await getConfig();
    const bugsCommand = new SlashCommandBuilder().setName('editbugs').setDescription('Bug report commands').setDefaultMemberPermissions(0).setDMPermission(false)
    const bugReports = new Set(fs.existsSync('bug-reports.json') ? JSON.parse(fs.readFileSync('bug-reports.json', 'utf8')) : null)

    bugsCommand.addSubcommand(new SlashCommandSubcommandBuilder()
        .setName('fixed')
        .setDescription('Remove a bug report.')
        .addStringOption(new SlashCommandStringOption().setName('id').setDescription('Message ID').setRequired(true))
    )

    bugsCommand.addSubcommand(new SlashCommandSubcommandBuilder()
        .setName('add')
        .setDescription('Mark a message as a bug report.')
        .addStringOption(new SlashCommandStringOption().setName('id').setDescription('Message ID').setRequired(true))
    )

    const writeBugs = done => {
        fs.writeFile('bug-reports.json', JSON.stringify(Array.from(bugReports)), 'utf8', done)
    }

    client.on('threadCreate', async thread => {
        if (thread.parent.id === bugReportsChannel) {
            await thread.send(`Bug report created by <@${thread.ownerId}>.\n(Adding <@${thread.guild.ownerId}>.)`)

            await lock.acquire('bugReports', done => {
                if (!bugReports.has(thread.id)) {
                    bugReports.add(thread.id)
                    writeBugs(done)
                } else {
                    done()
                }
            });
        }
    })

    client.on('interactionCreate', async interaction => {
        if (!interaction.isCommand()) {
            return
        }
        const {commandName, options} = interaction as ChatInputCommandInteraction
        if (commandName === 'editbugs') {
            const channel = interaction.guild.channels.cache.get(bugReportsChannel) as TextChannel
            switch (options.getSubcommand()) {
                case 'add': {
                    const id = options.getString('id')
                    await interaction.deferReply()

                    const message = await channel.messages.fetch(id)
                    if (!message) {
                        await interaction.editReply('Could not find message.')
                    } else {
                        const failed = await lock.acquire('bugReports', done => {
                            if (!bugReports.has(id)) {
                                bugReports.add(id)
                                writeBugs(done)
                            } else {
                                done(undefined, true)
                            }
                        });

                        if (failed) {
                            await interaction.editReply('Message is already a bug report')
                        } else {
                            await interaction.editReply('Message has been marked as a bug report.')
                        }
                    }

                    break
                }
                case 'fixed': {
                    const id = options.getString('id')
                    await interaction.deferReply()

                    const message = await channel.messages.fetch(id)
                    if (!message) {
                        await interaction.editReply('Could not find message.')
                    } else {
                        const failed = await lock.acquire('bugReports', done => {
                            if (bugReports.has(id)) {
                                bugReports.delete(id)
                                writeBugs(done)
                            } else {
                                done(undefined, true)
                            }
                        });

                        if (failed) {
                            await interaction.editReply('Message is not a bug report.')
                        } else {
                            await interaction.editReply('Bug report has been removed.')
                        }
                    }
                    break
                }
            }
        }
    })

    return bugsCommand.toJSON()
}
