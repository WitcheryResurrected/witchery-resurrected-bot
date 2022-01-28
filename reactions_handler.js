const {reactionRoles} = require('./config.json');

module.exports = client => {
    function createReactionEvent(callback) {
        return async (reaction, user) => {
            if (reactionRoles.message === reaction.message.id) {
                const role = reactionRoles.reactions[reaction.emoji.name];
                if (role) await callback(await reaction.message.guild.members.fetch(user.id), role)
            }
        };
    }

    client.on('messageReactionAdd', createReactionEvent((member, role) => member.roles.add(role)));
    client.on('messageReactionRemove', createReactionEvent((member, role) => member.roles.remove(role)));
}
