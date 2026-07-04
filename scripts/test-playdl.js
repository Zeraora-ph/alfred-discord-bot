// Script de teste para verificar estrutura do play-dl
const play = require('play-dl');

async function test() {
    console.log('🔍 Testando busca do play-dl...\n');

    const query = 'Avenged Sevenfold Nightmare';
    console.log(`Query: "${query}"\n`);

    try {
        const results = await play.search(query, { limit: 1 });

        if (results.length === 0) {
            console.log('❌ Nenhum resultado encontrado');
            return;
        }

        const track = results[0];

        console.log('=== RESULTADO ===\n');
        console.log('Tipo:', track.type);
        console.log('Título:', track.title);
        console.log('URL:', track.url);
        console.log('ID:', track.id);
        console.log('Duração:', track.durationRaw);
        console.log('Canal:', track.channel?.name);
        console.log('Thumbnail:', track.thumbnails?.[0]?.url);

        console.log('\n=== TODAS AS PROPRIEDADES ===\n');
        console.log(Object.keys(track));

        console.log('\n=== OBJETO COMPLETO ===\n');
        console.log(JSON.stringify(track, null, 2));

    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

test();
