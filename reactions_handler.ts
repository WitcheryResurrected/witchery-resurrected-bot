import {reactionRoles} from './config.json'
import {Client, GuildMember, MessageReaction, PartialMessageReaction, PartialUser, Role, User} from "discord.js";

export default (client: Client) => {
    function createReactionEvent(
        callback: (member: GuildMember, role: Role) => Promise<void>
    ): (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => Promise<void> {
        return async (reaction, user) => {
            if (reactionRoles.message === reaction.message.id) {
                const role = reactionRoles.reactions[reaction.emoji.name]
                if (role) await callback(await reaction.message.guild.members.fetch(user.id), role)
            }
        }
    }

    client.on('messageReactionAdd', createReactionEvent(async (member, role) => {
        await member.roles.add(role)
    }))

    client.on('messageReactionRemove', createReactionEvent(async (member, role) => {
        await member.roles.remove(role)
    }))
}
