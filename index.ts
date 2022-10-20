import AsyncLock from 'async-lock'

import {REST} from '@discordjs/rest'
import {Routes, Snowflake} from 'discord-api-types/v10'
import {Client, IntentsBitField, Partials} from 'discord.js'

import {guildId, suggestionPermissions, token} from './config.json'

import setupSuggestionEdits from './edit_suggestions_command'
import setupSuggestionFetches from './fetch_suggestions_command'
import setupBugReports from './bug_reports_command'
import setupLeaveHandler from './logs_handler'
import setupReactionHandler from './reactions_handler'

async function main() {
    const client = new Client({
        partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
        intents: [
            IntentsBitField.Flags.Guilds,
            IntentsBitField.Flags.GuildMembers,
            IntentsBitField.Flags.GuildBans,
            IntentsBitField.Flags.GuildMessages,
            IntentsBitField.Flags.GuildMessageReactions
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
        const rest = new REST({version: '10'}).setToken(token)
        let applicationCommandResults = await rest.put(Routes.applicationCommands(client.application.id), {
            body: [editBugs, editSuggestions, fetchSuggestions]
        })

        for (const command of [applicationCommandResults[0], applicationCommandResults[1]]) {
            const appCommand = await client.application.commands.fetch(command.id as Snowflake)
            await appCommand.permissions.add({guild: guildId, permissions: suggestionPermissions, token})
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
