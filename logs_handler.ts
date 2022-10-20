import {
    AuditLogEvent, Client, Guild, GuildAuditLogsEntry, GuildBan, GuildMember, PartialGuildMember, TextChannel,
    User
} from 'discord.js';

import {guildId, welcomesChannel, discordWelcomesChannel, logChannel, nitroChannel, nitroBoostRole} from './config.json'
import {Snowflake} from "discord-api-types/v10";

export default (client: Client, lock) => {
    const pendingMembers = new Set()
    const leaveStates: Record<Snowflake,
        {
            kick?: GuildAuditLogsEntry<AuditLogEvent.MemberKick> | null,
            ban?: GuildBan | null,
            timeoutHandle?: ReturnType<typeof setTimeout>
        }> = {}

    let logs: TextChannel

    async function getKick(member: GuildMember | PartialGuildMember) {
        const kick = (await member.guild.fetchAuditLogs({limit: 1, type: AuditLogEvent.MemberKick})).entries.first()
        if (!kick || Date.now() - kick.createdTimestamp > 3000) return null
        return member.id === kick.target.id ? kick : null
    }

    function memberLeft(member: GuildMember | PartialGuildMember | User, guild: Guild, done) {
        const leaveState = leaveStates[member.id]
        const tag = member instanceof User ? member.tag : member.user.tag
        const channel = guild.channels.cache.get(welcomesChannel) as TextChannel

        if (leaveState.ban) {
            if (typeof leaveState.ban === 'string') {
                channel.send(`Curse you warlock, don't ever return! (${tag} has been banned from ${guild.name} for ${leaveState.ban})`)
                    .then(() => done())
                    .catch(done)
            }
        } else {
            const callback = () => {
                const name = member instanceof User ? member.username : member.displayName
                delete leaveStates[member.id];
                if (leaveState.kick) {
                    if (typeof leaveState.kick === 'string') {
                        channel.send(`Off to torment with you, ${name}! (${tag} has been kicked from ${guild.name} for ${leaveState.kick})`)
                            .then(() => done())
                            .catch(done)
                    } else {
                        channel.send(`Off to torment with you, ${name}! (${tag} has been kicked from ${guild.name})`)
                            .then(() => done())
                            .catch(done)
                    }
                } else {
                    channel.send(`Shame, ${name} was brewing a nice concoction as well (${tag} has left ${guild.name})`)
                        .then(() => done())
                        .catch(done)
                }
            }

            if (leaveState.kick) {
                callback()
            } else {
                getKick(member as GuildMember).then(kick => {
                    leaveState.kick = kick
                    callback()
                }).catch(done)
            }
        }
    }

    client.on('ready', client => client.guilds.cache.get(guildId)
        .channels.fetch(logChannel)
        .then(channel => {
            logs = channel as TextChannel
        })
    );

    client.on('guildMemberAdd', async member => {
        await logs.send(`User ${member} entered membership screening.`)

        await lock.acquire('pendingMembers', done => {
            pendingMembers.add(member.id)
            done()
        })
    })

    client.on('guildMemberRemove', async member => {
        if (await lock.acquire('pendingMembers', done => done(undefined, pendingMembers.has(member.id)))) {
            await logs.send(`User ${member}[${member.user.tag}] left membership screening.`)
        } else {
            await logs.send(`User ${member}[${member.user.tag}] left the server.`)

            await lock.acquire('leaveStates', done => {
                const leaveState = leaveStates[member.id]
                if (leaveState) {
                    memberLeft(member, member.guild, done)
                } else {
                    getKick(member).then(kick => {
                        if (kick) {
                            leaveStates[member.id] = {kick}
                            memberLeft(member, member.guild, done)
                        } else {
                            leaveStates[member.id] = {
                                timeoutHandle: setTimeout(() => lock.acquire('leaveStates', done => {
                                    memberLeft(member, member.guild, done)
                                }), 1500)
                            }
                            done()
                        }
                    }).catch(done)
                }
            })
        }
    })

    client.on('guildBanAdd', async ban => {
        const fullBan = await ban.fetch(true)
        await lock.acquire('leaveStates', done => {
            const leaveState = leaveStates[fullBan.user.id]
            if (leaveState) {
                leaveState.ban = fullBan

                // If we know it's a ban, why wait?
                clearTimeout(leaveState.timeoutHandle)
                memberLeft(fullBan.user, fullBan.guild, done)
            } else {
                leaveStates[fullBan.user.id] = {ban: fullBan}
            }
            done()
        })
    })

    client.on('messageCreate', async message => {
        if (message.channelId === discordWelcomesChannel && message.system) {
            await lock.acquire('pendingMembers', done => {
                if (pendingMembers.has(message.member.id)) {
                    pendingMembers.delete(message.member.id);
                    (message.guild.channels.cache.get(welcomesChannel) as TextChannel)
                        .send(`Welcome ${message.member} to the Witch's Grove`)
                        .then(() => done()).catch(done)
                } else {
                    done()
                }
            })
        }
    })

    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        if (!oldMember.roles.resolve(nitroBoostRole) && newMember.roles.resolve(nitroBoostRole)) {
            await (newMember.guild.channels.cache.get(nitroChannel) as TextChannel)
                .send(`🎉 🎉 Thank you ${newMember} for boosting ${newMember.guild.name}!! 🎉 🎉`)
        }
    })
}
