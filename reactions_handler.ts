import {
    Client,
    GuildMember,
    MessageReaction,
    PartialMessageReaction,
    PartialUser,
    Role,
    RoleResolvable,
    User
} from "discord.js";
import {getConfig} from "./config";

export default (client: Client) => {
    function createReactionEvent(
        callback: (member: GuildMember, role: RoleResolvable) => Promise<void>
    ): (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => Promise<void> {
        return async (reaction, user) => {
            const {reactionRoles} = await getConfig();
            if (reactionRoles.message === reaction.message.id) {
                const role = reactionRoles.reactions[reaction.emoji.name]
                if (role) await callback(await reaction.message.guild.members.fetch(user.id), role.role)
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
