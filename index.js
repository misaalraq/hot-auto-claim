const { connect, keyStores, KeyPair } = require("near-api-js");
const { readFileSync } = require("fs");
const moment = require("moment");
const prompts = require("prompts");
const crypto = require("crypto");
const dotenv = require('dotenv');
dotenv.config();

const TelegramBot = require("node-telegram-bot-api");

// LOAD ENV
const token = process.env.TELEGRAM_BOT_TOKEN;
const userId = process.env.TELEGRAM_USER_ID;

// INIT TELEGRAM BOT
const bot = new TelegramBot(token);

// CREATE DELAY IN MILLISECONDS
const delay = (timeInMinutes) => {
    return new Promise((resolve) => {
        return setTimeout(resolve, timeInMinutes * 60 * 1000);
    });
}

(async () => {
    // IMPORT LIST ACCOUNT
    const listAccounts = readFileSync("./private.txt", "utf-8")
        .split("\n")
        .map((a) => a.trim())
        .filter((a) => !!a); // Filter out any empty lines

    // CHOOSE DELAY
    const chooseDelay = await prompts({
        type: 'select',
        name: 'time',
        message: 'Select time for each claim',
        choices: [
            { title: '2 hours', value: (2 * 60) },
            { title: '3 hours', value: (3 * 60) },
            { title: '4 hours', value: (4 * 60) },
        ],
    });

    // USE TELEGRAM BOT CONFIRMATION
    const botConfirm = await prompts({
        type: 'confirm',
        name: 'useTelegramBot',
        message: 'Use Telegram Bot as Notification?',
    });

    // CLAIMING PROCESS
    while (true) {
        for (const [index, value] of listAccounts.entries()) {
            const [PRIVATE_KEY, ACCOUNT_ID] = value.split("|");

            try {
                const myKeyStore = new keyStores.InMemoryKeyStore();
                const keyPair = KeyPair.fromString(PRIVATE_KEY);
                await myKeyStore.setKey("mainnet", ACCOUNT_ID, keyPair);

                const connection = await connect({
                    networkId: "mainnet",
                    nodeUrl: "https://rpc.mainnet.near.org",
                    keyStore: myKeyStore,
                });

                const wallet = await connection.account(ACCOUNT_ID);

                console.log(
                    `[${moment().format("HH:mm:ss")}] Claiming ${ACCOUNT_ID}`
                );

                // CALL CONTRACT AND GET THE TX HASH
                const callContract = await wallet.functionCall({
                    contractId: "game.hot.tg",
                    methodName: "claim",
                    args: {},
                });

                if (!callContract || !callContract.transaction || !callContract.transaction.actions || callContract.transaction.actions.length === 0) {
                    console.error(`Error processing ${ACCOUNT_ID}: Invalid transaction data`);
                    continue; // Skip to the next iteration
                }

                // Parse logs for claimed amounts
                const logs = callContract.receipts_outcome.flatMap(outcome => outcome.outcome.logs);
                const claimLogs = logs.filter(log => log.includes('EVENT_JSON'));

                let claimDetails = [];
                claimLogs.forEach(log => {
                    const eventJson = log.split('EVENT_JSON:')[1];
                    const event = JSON.parse(eventJson);
                    const ownerData = event.data;

                    ownerData.forEach(data => {
                        const amount = parseFloat(data.amount) / 1000000; // Convert to HOT
                        claimDetails.push({
                            ownerId: data.owner_id,
                            amount: amount.toFixed(6)
                        });
                    });
                });

                const hash = callContract.transaction.hash;

                // SEND NOTIFICATION BOT
                if (botConfirm.useTelegramBot) {
                    let message = `Claimed HOT for ${ACCOUNT_ID}\n*Amount*:\n`;
                    claimDetails.forEach(detail => {
                        message += `- ${detail.amount} HOT (for ${detail.ownerId})\n`;
                    });
                    message += `\n*Tx*: https://nearblocks.io/id/txns/${hash}`;

                    try {
                        await bot.sendMessage(
                            userId,
                            message,
                            { parse_mode: "Markdown", disable_web_page_preview: true }
                        );
                    } catch (error) {
                        console.log(`Send message failed, ${error}`)
                    }
                }
            } catch (error) {
                console.error(`Error processing ${ACCOUNT_ID}: ${error}`);
            }
        }

        // REDUCE REAL MINUTES WITH RANDOM
        const randomMinutes = crypto.randomInt(1, 9);
        const delayMinutes = chooseDelay.time - randomMinutes;

        console.log(`[ NEXT CLAIM IN ${moment().add(delayMinutes, 'minutes').format("HH:mm:ss")} ]`);
        await delay(delayMinutes);
    }

})();
