import { itemizedPrompts } from '../../../itemized-prompts.js';
import { event_types, getRequestHeaders } from '../../../../script.js';
import { localforage } from '/lib.js';

const BULK_SIZE = 128;

const promptStorage = localforage.createInstance({ name: 'SillyTavern_Prompts' });

async function updateBulk(chat_id, bulkops) {
    await fetch('/api/plugins/persistentitemizedprompts/bulk?chatId=' + encodeURIComponent(chat_id), {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(bulkops),
    });
}

async function loadChat(chat_id) {
    const response  = await fetch('/api/plugins/persistentitemizedprompts/mesIds?chatId=' + encodeURIComponent(chat_id), {
        method: 'GET',
        headers: getRequestHeaders()
    });
    const prompts = [];
    const result = await response.json();
    for (let i = 0; i < result.length; i += BULK_SIZE) {
        const chunk = result.slice(i, i + BULK_SIZE);
        const res  = await fetch('/api/plugins/persistentitemizedprompts/prompts?chatId=' + encodeURIComponent(chat_id), {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(chunk),
        });
        const messages = await res.json();
        messages.forEach((message) => {
            prompts[message.id] = message.prompt;
        })
    }
    return prompts;
}

async function bulkPersist(chat_id, prompts, max= BULK_SIZE) {
    let bulkops = [];
    for (let i=0; i<prompts.length; i++) {
        const prompt = prompts[i];
        if (prompt) {
            bulkops.push({
                messageId: i,
                op: 'persist',
                data: prompt
            });
        } else {
            bulkops.push({
                messageId: i,
                op: 'delete',
            })
        }
        if (bulkops.length > max) {
            await updateBulk(chat_id, bulkops);
            bulkops = [];
        }
    }
    if (bulkops) {
        await updateBulk(chat_id, bulkops);
    }
}

async function load_chat(chat_id) {
    try {
        if (!chat_id) {
            itemizedPrompts.length = 0;
            return;
        }

        itemizedPrompts.length = 0;
        const data =  await loadChat(chat_id);

        if (data) {
            for (let i=0; i<data.length; i++) {
                itemizedPrompts[i] = data[i];
                itemizedPrompts[i]._src = 'server';
            }
        }

    } catch {
        console.log('Error loading itemized prompts for chat', chat_id);
        itemizedPrompts.length = 0;
    }
}

async function save_chat(chat_id) {
    try {
        if (!chat_id) {
            return;
        }

        await bulkPersist(chat_id, itemizedPrompts);
    } catch {
        console.log('Error saving itemized prompts for chat', chat_id);
    }
}

async function delete_chat(chat_id, all) {
    if (all) {
        await fetch('/api/plugins/persistentitemizedprompts/deleteAll' + encodeURIComponent(chat_id), {
            method: 'GET',
            headers: getRequestHeaders()
        });
    } else {
        await fetch('/api/plugins/persistentitemizedprompts/delete?chatId=' + encodeURIComponent(chat_id), {
            method: 'GET',
            headers: getRequestHeaders()
        });
    }
}

async function synchronize() {
    const keys = await promptStorage.keys();
    for (const chat_id of keys) {
        const prompts = await promptStorage.getItem(chat_id);
        if (prompts) {
            await bulkPersist(chat_id, prompts);
        }
    }
}

async function initialize_persistent_storage() {
    const response = await fetch('/api/plugins/persistentitemizedprompts/open', {
        method: 'POST',
        headers: getRequestHeaders(),
    });
    if (response.status === 201) {
        await synchronize();
    }
}

async function message_appended() {
    const ctx = SillyTavern.getContext();
    if (ctx.chat_id)
        await save_chat(ctx.chat_id);
}

// noinspection JSUnresolvedReference
jQuery(async function () {
    await initialize_persistent_storage();

    const context = SillyTavern.getContext();
    context.eventSource.on(event_types.ITEMIZED_PROMPTS_LOADED, async ({chatId}) => await load_chat(chatId));
    context.eventSource.on(event_types.ITEMIZED_PROMPTS_SAVED, async ({chatId}) => await save_chat(chatId));
    context.eventSource.on(event_types.ITEMIZED_PROMPTS_DELETED, async ({chatId, all}) => await delete_chat(chatId, all));
    context.eventSource.on(event_types.USER_MESSAGE_RENDERED, async () => await message_appended());
});
