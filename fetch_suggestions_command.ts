import axios from 'axios';

import {
    EmbedBuilder,
    SlashCommandBooleanOption,
    SlashCommandBuilder,
    SlashCommandIntegerOption,
    SlashCommandStringOption,
    SlashCommandSubcommandBuilder,
    SlashCommandUserOption
} from '@discordjs/builders'

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    Client,
    MessagePayload,
    TextChannel, WebhookEditMessageOptions
} from 'discord.js'

import {guildId, host, suggestionsChannel} from './config.json'

export default (client: Client, lock, states: string[]) => {
    const activeUserInteractions = {}

    const suggestionsViewCommand = new SlashCommandBuilder().setName('getsuggestions').setDescription('Get suggestion details.')

    const add = (builder: SlashCommandSubcommandBuilder) => {
        suggestionsViewCommand.addSubcommand(builder.addBooleanOption(new SlashCommandBooleanOption()
            .setName('hidden')
            .setDescription('If the result of this command should be hidden. Default is true.')
        ))
    }

    add(new SlashCommandSubcommandBuilder()
        .setName('view')
        .setDescription('View a specific suggestion by suggestion ID.')
        .addIntegerOption(
            new SlashCommandIntegerOption()
                .setName('id')
                .setDescription('Suggestion ID')
                .setRequired(true)
        )
    )

    add(new SlashCommandSubcommandBuilder()
        .setName('user')
        .setDescription('View a list of suggestions by a user.')
        .addUserOption(
            new SlashCommandUserOption()
                .setName('user')
                .setDescription('The user to find suggestions of.')
                .setRequired(true)
        )
    )

    add(new SlashCommandSubcommandBuilder()
        .setName('message')
        .setDescription('View a suggestion via its message ID.')
        .addStringOption(
            new SlashCommandStringOption()
                .setName('id')
                .setDescription('Message ID.')
                .setRequired(true)
        )
    )

    async function fetchSuggestions(
        path: string,
        interaction: ChatInputCommandInteraction,
        reply: (result) => Promise<string | MessagePayload | WebhookEditMessageOptions>,
        {
            failMessage = 'Failed to fetch suggestion.',
            notFoundMessage = failMessage
        }: {
            failMessage?: string
            notFoundMessage?: string
        }
    ) {
        let hidden = interaction.options.getBoolean('hidden') ?? true
        await interaction.deferReply({ephemeral: hidden})
        const result = await axios.get(`${host}/suggestions/${path}`, {
            headers: {
                'Content-Type': 'application/json'
            }
        })
        if (result.status !== 200) {
            if (result.status === 404) {
                const options = {content: notFoundMessage, ephemeral: true}
                await interaction.editReply(options)
            } else {
                const options = {content: failMessage, ephemeral: true}
                await interaction.editReply(options)
            }
        } else {
            await interaction.editReply(await reply(result))
        }
    }

    client.on('interactionCreate', async interaction => {
        const guild = client.guilds.cache.get(guildId)
        const channel = guild.channels.cache.get(suggestionsChannel) as TextChannel
        const toEmbed = async suggestion => {
            const message = channel ? await channel.messages.fetch(suggestion.messageId) : null
            const embed = new EmbedBuilder()
                .setTitle(`Suggestion #${suggestion.id}`)
                .addFields(
                    {name: 'Author:', value: `<@${suggestion.authorId}>`},
                    {name: 'Approval State:', value: states[suggestion.state]}
                )

            if (message) {
                embed.setDescription(message.content.length < 29 ? `[${message.content}](${message.url})` : `[${message.content.substring(0, 29)}...](${message.url})`)
            } else {
                embed.setDescription('Origin of suggestion is unknown.')
            }

            if (suggestion.state > 4) {
                embed.setColor(0xFF0000)
            } else if (suggestion.state > 0) {
                embed.setColor(0xFF00)
            }
            return embed
        }
        if (interaction.isButton()) {
            await interaction.deferUpdate()
            await lock.acquire('activeUserInteractions', done => {
                const [type, interactionId] = interaction.customId.split('-')
                const data = activeUserInteractions[interactionId]
                let sign
                switch (type) {
                    case 'left': {
                        sign = -1
                        break
                    }
                    case 'right': {
                        sign = 1
                        break
                    }
                    default:
                        sign = 0
                }

                const callback = embed => {
                    const row = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`left-${interactionId}`)
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji('⬅️')
                                .setDisabled(data.index === 0),
                            new ButtonBuilder()
                                .setCustomId(`right-${interactionId}`)
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji('➡️')
                                .setDisabled(data.index === data.suggestions.length - 1)
                        )

                    const reply = {
                        embeds: [embed],
                        ephemeral: true,
                        components: [row]
                    }

                    interaction.editReply(reply).then(() => done()).catch(done)
                }

                data.index += sign
                const embed = data.embeds[data.index]
                if (embed) {
                    callback(embed)
                } else {
                    toEmbed(data.suggestions[data.index]).then(e => {
                        data.embeds[data.index] = e
                        callback(e)
                    }).catch(done)
                }
            })
        } else if (!interaction.isCommand()) {
            return
        }

        const {commandName, options} = interaction as ChatInputCommandInteraction
        if (commandName === 'getsuggestions') {
            switch (options.getSubcommand()) {
                case 'view': {
                    await fetchSuggestions(
                        options.getInteger('id', true).toString(),
                        interaction as ChatInputCommandInteraction,
                        result => toEmbed(result).then(embed => ({embeds: [embed]})),
                        {
                            notFoundMessage: 'Invalid suggestion ID.'
                        }
                    )
                    break
                }
                case 'user': {
                    await fetchSuggestions(`by_author/${options.getUser('user', true).id}`, interaction as ChatInputCommandInteraction, async result => {
                        const suggestions = await result.json()

                        const embed = await toEmbed(suggestions[0])

                        const row = new ActionRowBuilder<ButtonBuilder>()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`left-${interaction.id}`)
                                    .setStyle(ButtonStyle.Secondary)
                                    .setEmoji('⬅️')
                                    .setDisabled(true),
                                new ButtonBuilder()
                                    .setCustomId(`right-${interaction.id}`)
                                    .setStyle(ButtonStyle.Secondary)
                                    .setEmoji('➡️')
                                    .setDisabled(suggestions.length === 1)
                            )

                        await lock.acquire('activeUserInteractions', done => {
                            activeUserInteractions[interaction.id] = {
                                suggestions,
                                index: 0,
                                embeds: [embed],
                                parent: interaction
                            }
                            done()
                        })

                        return {embeds: [embed], components: [row]}
                    }, {
                        failMessage: 'Failed to fetch suggestions.',
                        notFoundMessage: 'User has no suggestions.'
                    })
                    break
                }
                case 'message': {
                    await fetchSuggestions(
                        `by_message/${options.getString('id')}`,
                        interaction as ChatInputCommandInteraction,
                        async result => ({embeds: [await toEmbed(await result.json())]}),
                        {
                            notFoundMessage: 'Invalid message ID.'
                        }
                    )
                    break
                }
            }
        }
    })

    return suggestionsViewCommand.toJSON()
}
