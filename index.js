const AsyncLock = require('async-lock')

const {REST} = require('@discordjs/rest')
const {Routes} = require('discord-api-types/v9')
const {Client, Intents} = require('discord.js')

const {
    guildId,
    suggestionPermissions,
    token
} = require('./config.json')

const setupSuggestionEdits = require('./edit_suggestions_command.js')
const setupSuggestionFetches = require('./fetch_suggestions_command.js')
const setupBugReports = require('./bug_reports_command.js')
const setupLeaveHandler = require('./logs_handler.js')
const setupReactionHandler = require('./reactions_handler.js')

async function main() {
    const client = new Client({
        partials: ['MESSAGE', 'CHANNEL', 'REACTION', 'GUILD_MEMBER'],
        intents: [
            Intents.FLAGS.GUILDS,
            Intents.FLAGS.GUILD_MEMBERS,
            Intents.FLAGS.GUILD_BANS,
            Intents.FLAGS.GUILD_MESSAGES,
            Intents.FLAGS.GUILD_MESSAGE_REACTIONS
        ]
    })

    const states = [
        'Pending :alarm_clock:',
        'Approved :white_check_mark:',
        'Implemented :white_check_mark:',
        'Partially Approved :white_check_mark:',
        'Partially Implemented :white_check_mark:',
        'Denied :no_entry:',
        'Duplicate :no_entry:'
    ]

    const lock = new AsyncLock()
    const editBugs = setupBugReports(client, lock)
    const editSuggestions = setupSuggestionEdits(client, states)
    const fetchSuggestions = setupSuggestionFetches(client, lock, states)

    client.on('ready', async () => {
        const rest = new REST({version: '9'}).setToken(token)
        let applicationCommandResults = await rest.put(Routes.applicationCommands(client.application.id), {
            body: [editBugs, editSuggestions, fetchSuggestions]
        })

        for (const command of [applicationCommandResults[0], applicationCommandResults[1]]) {
            const appCommand = await client.application.commands.fetch(command.id)
            await appCommand.permissions.add({guild: guildId, permissions: suggestionPermissions})
        }

        console.log(`Ready, logged in as ${client.user.tag}`)
    })

    setupLeaveHandler(client, lock)
    setupReactionHandler(client)

    process.on('SIGINT', () => {
        console.log()
        console.log('Shutting down.')
        client.destroy()
        process.exit()
    })

    await client.login(token)
}

main().catch(console.error)
