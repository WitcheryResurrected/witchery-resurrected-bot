import {Snowflake} from "discord-api-types/v10";
import * as fs from "fs";
import {ApplicationCommand} from "discord.js";
import {
    APIApplicationCommandPermission
} from "discord-api-types/payloads/v10/_interactions/_applicationCommands/permissions";

type Config = {
    token: string;
    guildId: Snowflake;
    suggestionsChannel: Snowflake;
    discordWelcomesChannel: Snowflake;
    welcomesChannel: Snowflake;
    nitroChannel: Snowflake;
    logChannel: Snowflake;
    bugReportsChannel: Snowflake;
    nitroBoostRole: Snowflake;
    authorization: string;
    reactionRoles: {
        message: Snowflake;
        reactions: Record<string, {
            name: string;
            role: Snowflake;
        }>;
    };
    host: string;
    suggestionsPermissions: APIApplicationCommandPermission;
};

export const getConfig = () => new Promise<Config>((resolve, reject) => {
    fs.readFile("config.json", (error, data) => {
        if (error) {
            reject(error);
        } else {
            resolve(JSON.parse(data.toString()));
        }
    });
});
