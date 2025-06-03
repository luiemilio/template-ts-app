import * as https from 'node:https';
import * as qs from 'node:querystring';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import 'dotenv/config';
import { InlineQueryResultPhoto } from 'telegraf/typings/core/types/typegram';

const request = (query: string): Promise<any> => {
    console.log(query);
    if (typeof query !== 'string') {
        return;
    }
    
    const { BING_KEY } = process.env;

    const params = {
        q: query.replaceAll(' ', '+'),
        safeSearch: 'off',
        mkt: 'en-us',
        count: 35,
        offset: 0
    };

    const queryString = qs.stringify(params);

    const baseUrl = 'https://api.bing.microsoft.com/v7.0/images/search?';
    const url = `${baseUrl}${queryString}`;

    return new Promise((resolve, reject) => {
        https.get(
            url,
            {
                headers: {
                    'Ocp-Apim-Subscription-Key': BING_KEY
                }
            },
            (response) => {
                let body = '';

                response.on('data', (chunk) => {
                    body += chunk;
                });

                response.on('end', () => {
                    resolve(JSON.parse(body));
                });

                response.on('error', reject);
            }
        );
    });
};

const getRandomImageUrl = (urls: string[]): string | undefined => {
    const max = 10;
    
    if (urls && urls.length > 0) {
        const actualMax = urls.length < max ? urls.length : max;
        const index = Math.ceil(Math.random() * actualMax) - 1;

        return urls[index];
    }
};

const getUrls = (results: any[]): string[] => {
    const urls: string[] = [];

    results.forEach((result) => {
        if (result && 'contentUrl' in result && typeof result.contentUrl === 'string') {
            const { contentUrl } = result;
            const url = new URL(contentUrl);
            
            if (url.pathname.endsWith('.jpeg') || url.pathname.endsWith('.jpg')) {
                urls.push(contentUrl);
            }
        }
    })
    
    return urls;
};

const getInlineResults = (urls: string[], query: string): InlineQueryResultPhoto[] => {
    return urls.map((url, idx) => {
        return {
            type: 'photo',
            id: `${idx}`,
            photo_url: url,
            thumbnail_url: url,
            caption: `#remember ${query}`
        };
    });
};

(async (): Promise<void> => {
    try {
        const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));

        bot.on(message('text'), async (ctx): Promise<void> => {
            try {
                const {
                    update: {
                        message: { text }
                    }
                } = ctx;

                if (text.startsWith('#remember ')) {
                    const query = text.split(' ').slice(1).join(' ');

                    if (query) {
                        try {
                            console.log(query);
                            const results = await request(query);

                            if (results?.value && Array.isArray(results?.value) && results.value.length > 0) {
                                const urls = getUrls(results.value);
                                const image = getRandomImageUrl(urls);
                                
                                try {
                                    await ctx.replyWithPhoto(image, { has_spoiler: true });
                                } catch (error) {
                                    // retry once if this failed
                                    console.error(error.stack);
                                    console.error('Error replying with image... retrying...');
                                    const image = getRandomImageUrl(urls);
                                    await ctx.replyWithPhoto(image, { has_spoiler: true });
                                }
                            } else {
                                await ctx.reply('No results found');
                            }
                        } catch (error) {
                            console.error('Error finding image');
                            console.error(error.stack);
                            await ctx.reply(`Error finding image: ${error.message}`);
                        }
                    }
                }
            } catch (error) {
                console.error(
                    `Error while trying to handle message id: ${ctx.message.message_id}.\nText: ${ctx.update.message.text}\n${error.stack}`
                );
            }
        });

        bot.on('inline_query', async (ctx) => {
            const { inlineQuery: { query } } = ctx;
            
            if (query) {
                const results = await request(query);
                
                if (Array.isArray(results?.value) && results.value.length > 0) {
                    const urls = getUrls(results.value);
                    const inlineResults = getInlineResults(urls, query);
                    
                    return ctx.answerInlineQuery(inlineResults);
                }
            }
        });

        bot.on(message('photo'), async (ctx) => {
            const { message } = ctx;
            
            if (message && 'via_bot' in message && message.via_bot.is_bot && message.via_bot.username === 'rememberverse_bot' && message.chat.type !== 'private') {
                const fileId = message.photo[0].file_id;
                
                return bot.telegram.editMessageMedia(message.chat.id, message.message_id, null, { type: 'photo', media: fileId, has_spoiler: true, caption: (message as any).caption });
            }
        });

        bot.catch(console.error);

        await bot.launch();
    } catch (error) {
        console.error(error.stack);
    }
})();
