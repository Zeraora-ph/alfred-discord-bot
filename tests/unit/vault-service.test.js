const fs = require('fs').promises;
const path = require('path');
const vaultService = require('../../src/services/vault-service');

describe('VaultService - Obsidian Vault & Graph-RAG', () => {
    beforeAll(async () => {
        await vaultService.init();
    });

    afterAll(async () => {
        // Limpar diretório de teste do vault
        try {
            const cleanDir = async (dir) => {
                try {
                    const files = await fs.readdir(dir);
                    for (const file of files) {
                        const filepath = path.join(dir, file);
                        const stat = await fs.stat(filepath);
                        if (stat.isDirectory()) {
                            await cleanDir(filepath);
                            await fs.rmdir(filepath);
                        } else {
                            await fs.unlink(filepath);
                        }
                    }
                } catch {}
            };
            await cleanDir(vaultService.vaultDir);
        } catch {}
    });

    test('should extract WikiLinks correctly', () => {
        const text = 'Bob curte [[The Beatles]] e também [[Coldplay]] com [[Rock Music]].';
        const links = vaultService.extractWikiLinks(text);
        expect(links).toEqual(['The Beatles', 'Coldplay', 'Rock Music']);
    });

    test('should return empty list when no links present', () => {
        expect(vaultService.extractWikiLinks('Sem links aqui.')).toEqual([]);
        expect(vaultService.extractWikiLinks(null)).toEqual([]);
    });

    test('should auto-link common terms correctly', () => {
        const text = 'Eu jogo minecraft e programo em python nas horas vagas.';
        const linked = vaultService.autoLinkEntities(text);
        expect(linked).toContain('[[Minecraft]]');
        expect(linked).toContain('[[Python]]');
    });

    test('should write user profile, auto-link terms, link guild, and create dashboard', async () => {
        const data = {
            nickname: 'Bobby',
            preferredTone: 'casual',
            affinity: 90,
            memories: ['Membro do clã minecraft', 'Gosta de python'],
            relationships: ['Amigo de Alice'],
            guildId: 'guild123'
        };

        await vaultService.saveUserProfile('user123', 'Bob', data);

        const profilePath = path.join(vaultService.usersDir, 'user123.md');
        const fileContent = await fs.readFile(profilePath, 'utf8');

        expect(fileContent).toContain('**Apelido:** Bobby');
        expect(fileContent).toContain('**Tom Preferencial:** #casual');
        expect(fileContent).toContain('**Afinidade:** 90');
        expect(fileContent).toContain('[[Minecraft]]');
        expect(fileContent).toContain('[[Python]]');
        expect(fileContent).toContain('[[guilds/guild123|Servidor guild123]]');

        // guild correspondente criada com o membro?
        const guildPath = path.join(vaultService.guildsDir, 'guild123.md');
        const guildContent = await fs.readFile(guildPath, 'utf8');
        expect(guildContent).toContain('[[users/user123|Bob]]');

        // placeholders correspondentes criados?
        const topic1Path = path.join(vaultService.topicsDir, 'Minecraft.md');
        const topic2Path = path.join(vaultService.topicsDir, 'Python.md');
        
        const file1Exists = await fs.access(topic1Path).then(() => true).catch(() => false);
        const file2Exists = await fs.access(topic2Path).then(() => true).catch(() => false);

        expect(file1Exists).toBe(true);
        expect(file2Exists).toBe(true);

        // Dashboard.md criado?
        const dashboardPath = path.join(vaultService.vaultDir, 'Dashboard.md');
        const dashboardExists = await fs.access(dashboardPath).then(() => true).catch(() => false);
        expect(dashboardExists).toBe(true);

        const dashboardContent = await fs.readFile(dashboardPath, 'utf8');
        expect(dashboardContent).toContain('[[users/user123|Perfil de Bob (@user123)]]');
        expect(dashboardContent).toContain('Bob');
    });

    test('should resolve entangled contexts recursively', async () => {
        // Criar conteúdo personalizado de teste para o tópico Minecraft
        const minecraftPath = path.join(vaultService.topicsDir, 'Minecraft.md');
        await fs.writeFile(minecraftPath, '# Minecraft\nUm jogo sobre blocos que Bob gosta muito.\nTambém faz conexões com [[Jogos Eletrônicos]].', 'utf8');

        const gamesPath = path.join(vaultService.topicsDir, 'Jogos Eletrônicos.md');
        await fs.writeFile(gamesPath, '# Jogos Eletrônicos\nUma forma moderna de entretenimento digital.', 'utf8');

        // Fatos contendo a palavra Minecraft
        const matchedFacts = ['Bob faz parte do clã [[Minecraft]].'];

        // Executar busca de contexto emaranhado
        const context = await vaultService.getEntangledContext('Bob joga [[Minecraft]]?', matchedFacts, 2);

        expect(context).toContain('### Tópico Relacionado: [[Minecraft]]');
        expect(context).toContain('### Tópico Relacionado: [[Jogos Eletrônicos]]');
        expect(context).toContain('entretenimento digital');
    });
});
