const {welcomesChannel, discordWelcomesChannel, logChannel, nitroChannel, nitroBoostRole} = require("./config.json")

module.exports = (client, lock) => {
    const pendingMembers = new Set()
    const leaveStates = {}

    async function getKick(member) {
        const kick = (await member.guild.fetchAuditLogs({limit: 1, type: 'MEMBER_KICK'})).entries.first()
        if (Date.now() - kick.createdTimestamp > 3000) return null
        return kick && member.id === kick.target.id ? kick.reason || true : null
    }

    function memberLeft(member, guild, done) {
        const leaveState = leaveStates[member.id]
        const tag = member.tag || member.user.tag
        const channel = guild.channels.cache.get(welcomesChannel)

        if (leaveState.ban) {
            if (typeof leaveState.ban === 'string') {
                channel.send(`Curse you warlock, don't ever return! (${tag} has been banned from ${guild.name} for ${leaveState.ban})`)
                    .then(() => done())
                    .catch(done)
            }
        } else {
            const callback = () => {
                const name = member.displayName ?? member.username
                leaveStates[member.id] = undefined
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
                getKick(member).then(kick => {
                    leaveState.kick = kick
                    callback()
                }).catch(done)
            }
        }
    }

    client.on('guildMemberAdd', async member => {
        member.guild.channels.cache.get(logChannel).send(`User ${member} entered membership screening.`)

        await lock.acquire('pendingMembers', done => {
            pendingMembers.add(member.id)
            done()
        })
    })

    client.on('guildMemberRemove', async member => {
        if (await lock.acquire('pendingMembers', done => done(undefined, pendingMembers.has(member.id)))) {
            member.guild.channels.cache.get(logChannel).send(`User ${member}[${member.user.tag}] left membership screening.`)
        } else {
            member.guild.channels.cache.get(logChannel).send(`User ${member}[${member.user.tag}] left the server.`)
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
                leaveState.ban = fullBan.reason || true

                // If we know it's a ban, why wait?
                clearTimeout(leaveState.timeoutHandle)
                memberLeft(fullBan.user, fullBan.guild, done)
            } else {
                leaveStates[fullBan.user.id] = {ban: fullBan.reason || true}
            }
            done()
        })
    })

    client.on('messageCreate', async message => {
        if (message.channelId === discordWelcomesChannel && message.system) {
            await lock.acquire('pendingMembers', done => {
                if (pendingMembers.has(message.member.id)) {
                    pendingMembers.delete(message.member.id)
                    message.guild.channels.cache.get(welcomesChannel).send(`Welcome ${message.member} to the Witch's Grove`)
                }
                done()
            })
        }
    })

    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        if (!oldMember.roles.resolve(nitroBoostRole) && newMember.roles.resolve(nitroBoostRole)) {
            newMember.guild.channels.cache.get(nitroChannel).send(`🎉 🎉 Thank you ${newMember} for boosting ${newMember.guild.name}!! 🎉 🎉`)
        }
    })
}
