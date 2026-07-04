const play = require('play-dl');
const ytdl = require('ytdl-core');

async function test() {
    const url = 'https://www.youtube.com/watch?v=94bGzWyHbu0';
    console.log(`Testing stream for: ${url}`);

    try {
        console.log('--- Testing play-dl stream ---');
        const stream = await play.stream(url);
        console.log('✅ play-dl stream succeeded');
        console.log('Type:', stream.type);
    } catch (e) {
        console.error('❌ play-dl stream failed:', e);
    }

    try {
        console.log('\n--- Testing ytdl-core stream ---');
        const info = await ytdl.getInfo(url);
        console.log('ytdl info title:', info.videoDetails.title);
        const stream = ytdl(url, { filter: 'audioonly' });
        console.log('✅ ytdl-core stream object created');
    } catch (e) {
        console.error('❌ ytdl-core stream failed:', e);
    }
}

test();
