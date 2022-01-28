const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const {
    SlashCommandBuilder,
    SlashCommandSubcommandBuilder,
    SlashCommandIntegerOption,
    SlashCommandStringOption,
    Embed
} = require("@discordjs/builders");

const {guildId, suggestionsChannel, host, authorization} = require("./config.json");

module.exports = (client, states) => {
    const approvalStates = ['Pending', 'Approved', 'Implemented', 'Partially Approved', 'Partially Implemented', 'Denied', 'Duplicate'];
    const suggestionsCommand = new SlashCommandBuilder().setName('editsuggestions').setDescription('Suggestion commands').setDefaultPermission(false);

    suggestionsCommand.addSubcommand(new SlashCommandSubcommandBuilder()
        .setName('state')
        .setDescription('Set suggestion approval state.')
        .addIntegerOption(new SlashCommandIntegerOption().setName('id').setDescription('Suggestion ID').setRequired(true))
        .addStringOption(new SlashCommandStringOption().setName('state').setDescription('Approval State').setRequired(true)
            .addChoices(approvalStates.map(state => [state, state.toLowerCase().replace(' ', '_')])))
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

    async function modifySuggestions(path, interaction, method, reply, {
        body,
        failMessage,
        notFoundMessage = failMessage,
        contentType = 'application/json'
    }) {
        const result = await fetch(`${host}/suggestions/${path}`, {
            method,
            headers: {
                'Content-Type': contentType
            },
            body: body ? JSON.stringify({pass: authorization, ...body}) : JSON.stringify(authorization)
        });
        if (result.status !== 200) {
            if (result.status === 404) {
                await interaction.reply({content: notFoundMessage, ephemeral: true});
            } else {
                await interaction.reply({content: failMessage, ephemeral: true});
            }
        } else {
            await interaction.reply(await reply(result));
        }
    }

    client.on('messageCreate', async message => {
        if (message.channelId === suggestionsChannel && !message.author.bot && !message.system) {
            const addResult = await fetch(`${host}/suggestions/add/${message.id}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain'
                },
                body: JSON.stringify(authorization)
            });
            if (addResult.status !== 200) {
                await message.reply('Failed to request suggestion.');
            } else {
                await message.startThread({
                    name: `Suggestion #${parseInt(await addResult.text())} by ${message.member.displayName}, discussion thread`
                })
            }
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isCommand()) {
            return;
        }
        const {commandName, options} = interaction;
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
                    }[options.getString('state')];

                    await modifySuggestions(options.getInteger('id'), interaction, 'PATCH', async result => {
                        const suggestion = await result.json();
                        const guild = client.guilds.cache.get(guildId);
                        const channel = guild.channels.cache.get(suggestionsChannel);
                        const message = await channel.messages.fetch(suggestion.messageId);
                        const embed = new Embed()
                            .setTitle(`Suggestion #${suggestion.id} has been updated`)
                            .addField({name: 'Author:', value: `<@${suggestion.authorId}>`})
                            .addField({name: 'Approval State:', value: states[suggestion.state]})
                            .setDescription(message.content.length < 29 ? `[${message.content}](${message.url})` : `[${message.content.substr(0, 29)}...](${message.url})`);

                        if (suggestion.state > 4) {
                            embed.setColor(0xFF0000);
                        } else if (suggestion.state > 0) {
                            embed.setColor(0xFF00);
                        }

                        return {embeds: [embed]};
                    }, {
                        body: {state},
                        failMessage: 'Failed to update suggestion.',
                        notFoundMessage: 'Invalid suggestion ID.'
                    });
                    break;
                }
                case 'delete': {
                    await modifySuggestions(options.getInteger('id'), interaction, 'DELETE', async () => {
                        return {content: 'Suggestion deleted successfully.'};
                    }, {
                        failMessage: 'Failed to delete suggestion.',
                        notFoundMessage: 'Invalid suggestion ID.'
                    });
                    break;
                }
                case 'add': {
                    const messageId = options.getString('id');
                    await modifySuggestions(`add/${messageId}`, interaction, 'POST', async result => {
                        const guild = client.guilds.cache.get(guildId);
                        const channel = guild.channels.cache.get(suggestionsChannel);
                        const message = await channel.messages.fetch(messageId);
                        return {
                            embeds: [
                                new Embed().setDescription(`Marked [message](${message.url}) by ${message.author} as suggestion with ID ${await result.text()}.`)
                            ]
                        }
                    }, {
                        failMessage: 'Failed to request suggestion.',
                        notFoundMessage: 'Invalid message ID.',
                        contentType: 'text/plain'
                    });
                    break;
                }
            }
        }
    });

    return suggestionsCommand.toJSON();
};
