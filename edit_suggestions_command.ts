import axios, {AxiosResponse, Method} from 'axios';

import {
    SlashCommandBuilder,
    SlashCommandSubcommandBuilder,
    SlashCommandIntegerOption,
    SlashCommandStringOption,
    EmbedBuilder
} from '@discordjs/builders'

import {
    ChatInputCommandInteraction,
    Client,
    CommandInteraction,
    ForumChannel,
    InteractionReplyOptions,
    TextChannel
} from "discord.js";
import {getConfig} from "./config";

export default async (client: Client, states: string[]) => {
    const {guildId, suggestionsChannel, logChannel, host, authorization} = await getConfig();
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
        .setDescription('Mark a post as a suggestion.')
        .addStringOption(new SlashCommandStringOption().setName('id').setDescription('Thread ID').setRequired(true))
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
        let result: AxiosResponse

        try {
            result = await axios(`${host}/suggestions/${path}`, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: body ? {pass: authorization, ...body} : authorization
            })
        } catch (error) {
            if (error.response.status === 404) {
                await interaction.reply({content: notFoundMessage, ephemeral: true})
            } else {
                await interaction.reply({content: failMessage, ephemeral: true})
                await (client.channels.cache.get(logChannel) as TextChannel)
                    .send(`<@${interaction.guild.ownerId}> Request to suggestion path ${path} failed\nStatus Code: ${error.response.status}\nStatus Text: ${error.response?.statusText}`)
            }

            return
        }

        await interaction.reply(await reply(result.data))
    }

    client.on('threadCreate', async thread => {
        if (thread.parent.id === suggestionsChannel) {
            const message = await thread.fetchStarterMessage();

            let addResult: AxiosResponse

            try {
                addResult = await axios.post(`${host}/suggestions/add`, {
                    pass: authorization,
                    creatorId: thread.ownerId,
                    threadId: thread.id,
                    title: thread.name,
                    content: message.content,
                    creatorName: message.author.username
                }, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
            } catch (error) {
                await thread.send('Failed to request suggestion.');

                await (client.channels.cache.get(logChannel) as TextChannel)
                    .send(`<@${thread.guild.ownerId}> Request to suggestion path add/${thread.id}/${message.id} failed\nStatus Code: ${error.response.status}\nStatus Text: ${error.response?.statusText}`)

                return
            }

            await thread.send(`Suggestion #${addResult.data} created by <@${thread.ownerId}>.\n(Adding <@${thread.guild.ownerId}>.)`);
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
                        const channel = guild.channels.cache.get(suggestionsChannel) as ForumChannel
                        const message = await channel.messages.fetch(suggestion.messageId)
                        const embed = new EmbedBuilder()
                            .setTitle(`Suggestion #${suggestion.id} has been updated`)
                            .addFields(
                                {name: 'Author:', value: `<@${suggestion.authorId}>`},
                                {name: 'Approval State:', value: states[suggestion.state.id - 1]}
                            )
                            .setDescription(message.content.length < 29 ? `[${message.content}](${message.url})` : `[${message.content.substring(0, 29)}...](${message.url})`)

                        if (suggestion.state.id > 5) {
                            embed.setColor(0xFF0000)
                        } else if (suggestion.state.id > 1) {
                            embed.setColor(0xFF00)
                        }

                        return {embeds: [embed]}
                    }, {
                        body: {stateId: state + 1},
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
                    const threadId = options.getString('id');
                    const guild = client.guilds.cache.get(guildId)
                    const channel = guild.channels.cache.get(suggestionsChannel) as ForumChannel;
                    const thread = channel.threads.cache.get(threadId);
                    if (thread) {
                        const message = await thread.fetchStarterMessage();

                        await modifySuggestions(`add`, interaction, 'POST', async result => {
                            const message = await channel.messages.fetch(threadId)
                            return {
                                embeds: [
                                    new EmbedBuilder().setDescription(`Marked [message](${message.url}) by ${message.author} as suggestion with ID ${result}.`)
                                ]
                            }
                        }, {
                            body: {
                                creatorId: thread.ownerId,
                                threadId: thread.id,
                                title: thread.name,
                                content: message.content,
                                creatorName: message.author.username
                            },
                            failMessage: 'Failed to request suggestion.',
                            notFoundMessage: 'Invalid message ID.'
                        })
                    } else {
                        await interaction.followUp({
                            ephemeral: true,
                            content: 'Post not found'
                        });
                    }
                    break
                }
            }
        }
    })

    return suggestionsCommand.toJSON()
}
