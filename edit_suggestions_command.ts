import axios, {Method} from 'axios';

import {
    SlashCommandBuilder,
    SlashCommandSubcommandBuilder,
    SlashCommandIntegerOption,
    SlashCommandStringOption,
    EmbedBuilder
} from '@discordjs/builders'

import {guildId, suggestionsChannel, logChannel, host, authorization} from './config.json'
import {
    ChatInputCommandInteraction,
    Client,
    CommandInteraction,
    InteractionReplyOptions,
    TextChannel
} from "discord.js";

export default (client: Client, states: string[]) => {
    const approvalStates = ['Pending', 'Approved', 'Implemented', 'Partially Approved', 'Partially Implemented', 'Denied', 'Duplicate']
    const suggestionsCommand = new SlashCommandBuilder().setName('editsuggestions').setDescription('Suggestion commands').setDefaultMemberPermissions(0).setDMPermission(false)

    suggestionsCommand.addSubcommand(new SlashCommandSubcommandBuilder()
        .setName('state')
        .setDescription('Set suggestion approval state.')
        .addIntegerOption(new SlashCommandIntegerOption().setName('id').setDescription('Suggestion ID').setRequired(true))
        .addStringOption(
            new SlashCommandStringOption()
                .setName('state')
                .setDescription('Approval State')
                .setRequired(true)
                .addChoices(
                    ...approvalStates.map(state => ({
                        name: state,
                        value: state.toLowerCase().replace(' ', '_')
                    }))
                )
        )
    )

    suggestionsCommand.addSubcommand(new SlashCommandSubcommandBuilder()
        .setName('delete')
        .setDescription('Remove a suggestion.')
        .addIntegerOption(new SlashCommandIntegerOption().setName('id').setDescription('Suggestion ID').setRequired(true))
    )

    suggestionsCommand.addSubcommand(new SlashCommandSubcommandBuilder()
        .setName('add')
        .setDescription('Mark a message as a suggestion.')
        .addStringOption(new SlashCommandStringOption().setName('id').setDescription('Message ID').setRequired(true))
    )

    async function modifySuggestions(
        path: string,
        interaction: CommandInteraction,
        method: Method,
        reply: (result) => Promise<InteractionReplyOptions>,
        {
            body,
            failMessage,
            notFoundMessage = failMessage
        }: {
            body?: any,
            failMessage: string,
            notFoundMessage: string
        }
    ) {
        const result = await axios(`${host}/suggestions/${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json'
            },
            data: body ? {pass: authorization, ...body} : authorization
        })
        if (result.status !== 200) {
            if (result.status === 404) {
                await interaction.reply({content: notFoundMessage, ephemeral: true})
            } else {
                await interaction.reply({content: failMessage, ephemeral: true})
                await (client.channels.cache.get(logChannel) as TextChannel)
                    .send(`<@${interaction.guild.ownerId}> Request to suggestion path ${path} failed\nStatus Code: ${result.status}\nStatus Text: ${result.statusText}`)
            }
        } else {
            await interaction.reply(await reply(result.data))
        }
    }

    client.on('messageCreate', async message => {
        if (message.channelId === suggestionsChannel && !message.author.bot && !message.system) {
            const addResult = await axios.post(`${host}/suggestions/add/${message.id}`, authorization, {
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            if (addResult.status !== 200) {
                message.thread.send('Failed to request suggestion.');
                await (client.channels.cache.get(logChannel) as TextChannel)
                    .send(`<@${message.guild.ownerId}> Request to suggestion path add/${message.id} failed\nStatus Code: ${addResult.status}\nStatus Text: ${addResult.statusText}`)
            } else {
                message.thread.send(`Suggestion #${addResult.data} created by ${message.member.displayName}. <@${message.guild.ownerId}>\``);
            }
        }
    })

    client.on('interactionCreate', async interaction => {
        if (!interaction.isCommand()) {
            return
        }
        const {commandName, options} = interaction as ChatInputCommandInteraction
        if (commandName === 'editsuggestions') {
            switch (options.getSubcommand()) {
                case 'state': {
                    const state = {
                        pending: 0,
                        approved: 1,
                        implemented: 2,
                        partially_approved: 3,
                        partially_implemented: 4,
                        denied: 5,
                        duplicate: 6
                    }[options.getString('state', true)]

                    await modifySuggestions(options.getInteger('id', true).toString(), interaction, 'PATCH', async suggestion => {
                        const guild = client.guilds.cache.get(guildId)
                        const channel = guild.channels.cache.get(suggestionsChannel) as TextChannel
                        const message = await channel.messages.fetch(suggestion.messageId)
                        const embed = new EmbedBuilder()
                            .setTitle(`Suggestion #${suggestion.id} has been updated`)
                            .addFields(
                                {name: 'Author:', value: `<@${suggestion.authorId}>`},
                                {name: 'Approval State:', value: states[suggestion.state]}
                            )
                            .setDescription(message.content.length < 29 ? `[${message.content}](${message.url})` : `[${message.content.substring(0, 29)}...](${message.url})`)

                        if (suggestion.state > 4) {
                            embed.setColor(0xFF0000)
                        } else if (suggestion.state > 0) {
                            embed.setColor(0xFF00)
                        }

                        return {embeds: [embed]}
                    }, {
                        body: {state},
                        failMessage: 'Failed to update suggestion.',
                        notFoundMessage: 'Invalid suggestion ID.'
                    })
                    break
                }
                case 'delete': {
                    await modifySuggestions(
                        options.getInteger('id', true).toString(),
                        interaction,
                        'DELETE',
                        async () => ({content: 'Suggestion deleted successfully.'}),
                        {
                            failMessage: 'Failed to delete suggestion.',
                            notFoundMessage: 'Invalid suggestion ID.'
                        }
                    )
                    break
                }
                case 'add': {
                    const messageId = options.getString('id')
                    await modifySuggestions(`add/${messageId}`, interaction, 'POST', async result => {
                        const guild = client.guilds.cache.get(guildId)
                        const channel = guild.channels.cache.get(suggestionsChannel) as TextChannel
                        const message = await channel.messages.fetch(messageId)
                        return {
                            embeds: [
                                new EmbedBuilder().setDescription(`Marked [message](${message.url}) by ${message.author} as suggestion with ID ${result}.`)
                            ]
                        }
                    }, {
                        failMessage: 'Failed to request suggestion.',
                        notFoundMessage: 'Invalid message ID.'
                    })
                    break
                }
            }
        }
    })

    return suggestionsCommand.toJSON()
}
