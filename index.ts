import AsyncLock from 'async-lock'

import {REST} from '@discordjs/rest'
import {Routes} from 'discord-api-types/v10'
import {Client, IntentsBitField, Partials} from 'discord.js'

import setupSuggestionEdits from './edit_suggestions_command'
import setupSuggestionFetches from './fetch_suggestions_command'
import setupBugReports from './bug_reports_command'
import setupLeaveHandler from './logs_handler'
import setupReactionHandler from './reactions_handler'
import {getConfig} from "./config";

async function main() {
    const {token} = await getConfig();
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
    const editBugs = await setupBugReports(client, lock)
    const editSuggestions = await setupSuggestionEdits(client, states)
    const fetchSuggestions = await setupSuggestionFetches(client, lock, states)

    client.on('ready', async () => {
        const rest = new REST({version: '10'}).setToken(token)

        await rest.put(Routes.applicationCommands(client.application.id), {
            body: [editBugs, editSuggestions, fetchSuggestions]
        })

        console.log(`Ready, logged in as ${client.user.tag}`)
    })

    await setupLeaveHandler(client, lock)
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
