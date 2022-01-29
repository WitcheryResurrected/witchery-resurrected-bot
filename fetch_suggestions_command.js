const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))

const {
    SlashCommandBuilder,
    SlashCommandSubcommandBuilder,
    SlashCommandIntegerOption,
    SlashCommandBooleanOption,
    SlashCommandUserOption,
    SlashCommandStringOption, Embed
} = require("@discordjs/builders")

const {MessageActionRow, MessageButton} = require("discord.js")

const {guildId, suggestionsChannel, host} = require("./config.json")

module.exports = (client, lock, states) => {
    const activeUserInteractions = {}

    const suggestionsViewCommand = new SlashCommandBuilder().setName('getsuggestions').setDescription('Get suggestion details.')

    const add = (builder) => {
        suggestionsViewCommand.addSubcommand(builder.addBooleanOption(new SlashCommandBooleanOption()
            .setName("hidden")
            .setDescription("If the result of this command should be hidden. Default is true.")
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

    async function fetchSuggestions(path, interaction, reply, {
        failMessage = 'Failed to fetch suggestion.',
        notFoundMessage = failMessage
    }) {
        let hidden = interaction.options.getBoolean("hidden", false) ?? true
        await interaction.deferReply({ephemeral: hidden})
        const result = await fetch(`${host}/suggestions/${path}`, {
            headers: {
                'Content-Type': 'application/json'
            }
        })
        if (result.status !== 200) {
            if (result.status === 404) {
                await interaction.editReply({content: notFoundMessage, ephemeral: true})
            } else {
                await interaction.editReply({content: failMessage, ephemeral: true})
            }
        } else {
            await interaction.editReply({
                ...(await reply(result)),
                ephemeral: hidden
            })
        }
    }

    client.on('interactionCreate', async interaction => {
        const guild = client.guilds.cache.get(guildId)
        const channel = guild.channels.cache.get(suggestionsChannel)
        const toEmbed = async suggestion => {
            const message = channel ? await channel.messages.fetch(suggestion.messageId) : null
            const embed = new Embed()
                .setTitle(`Suggestion #${suggestion.id}`)
                .addField({name: 'Author:', value: `<@${suggestion.authorId}>`})
                .addField({name: 'Approval State:', value: states[suggestion.state]})

            if (message) {
                embed.setDescription(message.content.length < 29 ? `[${message.content}](${message.url})` : `[${message.content.substr(0, 29)}...](${message.url})`)
            } else {
                embed.setDescription("Origin of suggestion is unknown.")
            }

            if (suggestion.state > 4) {
                embed.setColor(0xFF0000)
            } else if (suggestion.state > 0) {
                embed.setColor(0xFF00)
            }
            return embed
        }
        if (interaction.isButton()) {
            await interaction.deferUpdate({ephemeral: true})
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
                    const row = new MessageActionRow()
                        .addComponents(
                            new MessageButton()
                                .setCustomId(`left-${interactionId}`)
                                .setStyle('SECONDARY')
                                .setEmoji("⬅️")
                                .setDisabled(data.index === 0),
                            new MessageButton()
                                .setCustomId(`right-${interactionId}`)
                                .setStyle('SECONDARY')
                                .setEmoji("➡️")
                                .setDisabled(data.index === data.suggestions.length - 1)
                        )

                    interaction.editReply({embeds: [embed], ephemeral: true, components: [row]}).then(() => done()).catch(done)
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

        const {commandName, options} = interaction
        if (commandName === 'getsuggestions') {
            switch (options.getSubcommand()) {
                case 'view': {
                    await fetchSuggestions(options.getInteger('id'), interaction, async result => {
                        return {embeds: [await toEmbed(await result.json())]}
                    }, {
                        notFoundMessage: 'Invalid suggestion ID.'
                    })
                    break
                }
                case 'user': {
                    await fetchSuggestions(`by_author/${options.getUser('user').id}`, interaction, async result => {
                        const suggestions = await result.json()

                        const embed = await toEmbed(suggestions[0])

                        const row = new MessageActionRow()
                            .addComponents(
                                new MessageButton()
                                    .setCustomId(`left-${interaction.id}`)
                                    .setStyle('SECONDARY')
                                    .setEmoji("⬅️")
                                    .setDisabled(true),
                                new MessageButton()
                                    .setCustomId(`right-${interaction.id}`)
                                    .setStyle('SECONDARY')
                                    .setEmoji("➡️")
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
                    await fetchSuggestions(`by_message/${options.getString('id')}`, interaction, async result => {
                        return {embeds: [await toEmbed(await result.json())]}
                    }, {
                        notFoundMessage: 'Invalid message ID.'
                    })
                    break
                }
            }
        }
    })

    return suggestionsViewCommand.toJSON()
}
