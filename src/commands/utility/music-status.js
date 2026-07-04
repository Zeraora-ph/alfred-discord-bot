const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('music-status')
        .setDescription('Verifica o status do sistema de música'),

    async execute(interaction) {
        const musicManager = interaction.client.musicManager;
        const lavalinkStarter = interaction.client.lavalinkStarter;
        
        let status = '**🎵 Status do Sistema de Música:**\n\n';
        
        // Verificar MusicManager
        if (musicManager) {
            status += '✅ **MusicManager:** Ativo\n';
            
            // Verificar conexão com Lavalink
            if (musicManager.manager && musicManager.manager.nodes) {
                const nodes = musicManager.manager.nodes;
                if (nodes.size > 0) {
                    status += '✅ **Lavalink:** Conectado\n';
                    nodes.forEach((node, key) => {
                        status += `   📡 Nó: ${key} - ${node.state}\n`;
                    });
                } else {
                    status += '❌ **Lavalink:** Não conectado\n';
                }
            } else {
                status += '❌ **Lavalink:** Erro na conexão\n';
            }
        } else {
            status += '❌ **MusicManager:** Não disponível\n';
        }
        
        // Verificar LavalinkStarter
        if (lavalinkStarter) {
            status += `✅ **LavalinkStarter:** ${lavalinkStarter.isLavalinkRunning() ? 'Rodando' : 'Parado'}\n`;
        } else {
            status += '❌ **LavalinkStarter:** Não disponível\n';
        }
        
        // Verificar permissões do bot
        const member = interaction.member;
        if (member.voice.channel) {
            status += `✅ **Canal de voz:** ${member.voice.channel.name}\n`;
            
            const permissions = member.voice.channel.permissionsFor(interaction.client.user);
            if (permissions.has('Connect')) {
                status += '✅ **Permissão:** Pode conectar\n';
            } else {
                status += '❌ **Permissão:** Não pode conectar\n';
            }
            
            if (permissions.has('Speak')) {
                status += '✅ **Permissão:** Pode falar\n';
            } else {
                status += '❌ **Permissão:** Não pode falar\n';
            }
        } else {
            status += '❌ **Canal de voz:** Você não está em um canal\n';
        }
        
        await interaction.reply({ content: status, ephemeral: true });
    },
}; 