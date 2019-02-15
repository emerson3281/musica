const { Client, Util } = require('discord.js');
const { TOKEN, PREFIX, GOOGLE_API_KEY } = require('./config');
const YouTube = require('simple-youtube-api');
const ytdl = require('ytdl-core');

const client = new Client({ disableEveryone: true });

const youtube = new YouTube(GOOGLE_API_KEY);

const queue = new Map();

client.on('warn', console.warn);

client.on('error', console.error);

client.on('ready', () => console.log('Está pronto!'));

client.on('disconnect', () => console.log('Eu apenas desconectei, certificando-me de que você sabe, eu reconectarei agora ...'));

client.on('reconnecting', () => console.log('Estou me reconectando agora!'));

client.on('message', async msg => { // eslint-disable-line
	if (msg.author.bot) return undefined;
	if (!msg.content.startsWith(PREFIX)) return undefined;

	const args = msg.content.split(' ');
	const searchString = args.slice(1).join(' ');
	const url = args[1] ? args[1].replace(/<(.+)>/g, '$1') : '';
	const serverQueue = queue.get(msg.guild.id);

	let command = msg.content.toLowerCase().split(' ')[0];
	command = command.slice(PREFIX.length)

	if (command === 'play') {
		const voiceChannel = msg.member.voiceChannel;
		if (!voiceChannel) return msg.channel.send('Me desculpe, mas você precisa estar em um canal de voz para tocar música!');
		const permissions = voiceChannel.permissionsFor(msg.client.user);
		if (!permissions.has('CONNECT')) {
			return msg.channel.send('Não consigo me conectar ao seu canal de voz, verifique se tenho as permissões adequadas!');
		}
		if (!permissions.has('SPEAK')) {
			return msg.channel.send('Eu não posso falar neste canal de voz, verifique se eu tenho as permissões adequadas!');
		}
		if(!msg.member.roles.some(r=>["DJ", "dj", "Dj", "dJ"].includes(r.name))) return msg.reply('você precisa do cargo de `DJ`');

		if (url.match(/^https?:\/\/(www.youtube.com|youtube.com)\/playlist(.*)$/)) {
			const playlist = await youtube.getPlaylist(url);
			const videos = await playlist.getVideos();
			for (const video of Object.values(videos)) {
				const video2 = await youtube.getVideoByID(video.id); // eslint-disable-line no-await-in-loop
				await handleVideo(video2, msg, voiceChannel, true); // eslint-disable-line no-await-in-loop
			}
			return msg.channel.send(`<a:Certo:528327754463051787> Playlist: **${playlist.title}** foi adicionado à fila!`);
		} else {
			try {
				var video = await youtube.getVideo(url);
			} catch (error) {
				try {
					var videos = await youtube.searchVideos(searchString, 10);
					let index = 0;
					msg.channel.send(`
__**Seleção de músicas:**__
${videos.map(video2 => `**${++index} -** ${video2.title}`).join('\n')}
Forneça um valor para selecionar um dos resultados da pesquisa que vão de 1 a 10.
					`);
					// eslint-disable-next-line max-depth
					try {
						var response = await msg.channel.awaitMessages(msg2 => msg2.content > 0 && msg2.content < 11, {
							maxMatches: 1,
							time: 10000,
							errors: ['time']
						});
					} catch (err) {
						console.error(err);
						return msg.channel.send('Nenhum ou valor inválido inserido, cancelando a seleção de vídeo.');
					}
					const videoIndex = parseInt(response.first().content);
					var video = await youtube.getVideoByID(videos[videoIndex - 1].id);
				} catch (err) {
					console.error(err);
					return msg.channel.send('🆘 Não consegui obter nenhum resultado de pesquisa.');
				}
			}
			return handleVideo(video, msg, voiceChannel);
		}
	} else if (command === 'pular') {
		if (!msg.member.voiceChannel) return msg.channel.send('Você não está em um canal de voz!');
		if (!serverQueue) return msg.channel.send('Não há nada jogando que eu possa pular para você.');
		serverQueue.connection.dispatcher.end('O comando pular foi usado!');
		msg.channel.send(`⏹ ${msg.author}, Música pulada com sucesso!`)
		return undefined;
	} else if (command === 'parar') {
		if (!msg.member.voiceChannel) return msg.channel.send('Você não está em um canal de voz!');
		if (!serverQueue) return msg.channel.send('Não há nada tocando que eu pudesse parar para você.');
		serverQueue.songs = [];
		serverQueue.connection.dispatcher.end('Música parada com sucesso!');
		msg.channel.send(`⏹ ${msg.author}, Música parada com sucesso!`)
		return undefined;
	} else if (command === 'volume') {
		if (!msg.member.voiceChannel) return msg.channel.send('Você não está em um canal de voz!');
		if (!serverQueue) return msg.channel.send('Não há nada tocando.');
		if (!args[1]) return msg.channel.send(`🔊 O volume atual é: **${serverQueue.volume}**`);
		serverQueue.volume = args[1];
		serverQueue.connection.dispatcher.setVolumeLogarithmic(args[1] / 5);
	} else if (command === 'np') {
		if (!serverQueue) return msg.channel.send('Não há nada tocando.');
		return msg.channel.send(`<a:CD:524693422615822356> Tocando agora: **${serverQueue.songs[0].title}**`);
	} else if (command === 'queue') {
		if (!serverQueue) return msg.channel.send('Não há nada tocando.');
		return msg.channel.send(`
__**Fila de músicas:**__
${serverQueue.songs.map(song => `**-** ${song.title}`).join('\n')}
** Agora tocando:** ${serverQueue.songs[0].title}
		`);
	} else if (command === 'pausar') {
		if (serverQueue && serverQueue.playing) {
			serverQueue.playing = false;
			serverQueue.connection.dispatcher.pause();
			return msg.channel.send('⏸ você Pausou a música, para retomar digite `!!!resume` para retomar a musica');
		}
		return msg.channel.send('Não há nada tocando.');
	} else if (command === 'resume') {
		if (serverQueue && !serverQueue.playing) {
			serverQueue.playing = true;
			serverQueue.connection.dispatcher.resume();
			return msg.channel.send('▶ Música resumida!');
		}
		return msg.channel.send('Não há nada tocando.');
	}

	return undefined;
});

async function handleVideo(video, msg, voiceChannel, playlist = false) {
	const serverQueue = queue.get(msg.guild.id);
	console.log(video);
	const song = {
		id: video.id,
		title: Util.escapeMarkdown(video.title),
		url: `https://www.youtube.com/watch?v=${video.id}`
	};
	if (!serverQueue) {
		const queueConstruct = {
			textChannel: msg.channel,
			voiceChannel: voiceChannel,
			connection: null,
			songs: [],
			volume: 5,
			playing: true
		};
		queue.set(msg.guild.id, queueConstruct);

		queueConstruct.songs.push(song);

		try {
			var connection = await voiceChannel.join();
			queueConstruct.connection = connection;
			play(msg.guild, queueConstruct.songs[0]);
		} catch (error) {
			console.error(`Não consigo entrar na sala: ${error}`);
			queue.delete(msg.guild.id);
			return msg.channel.send(`Não consigo entrar na sala: ${error}`);
		}
	} else {
		serverQueue.songs.push(song);
		console.log(serverQueue.songs);
		if (playlist) return undefined;
		else return msg.channel.send(`<a:Certo:528327754463051787> **${song.title}** foi adicionado à fila!`);
	}
	return undefined;
}

function play(guild, song) {
	const serverQueue = queue.get(guild.id);

	if (!song) {
		serverQueue.voiceChannel.leave();
		queue.delete(guild.id);
		return;
	}
	console.log(serverQueue.songs);

	const dispatcher = serverQueue.connection.playStream(ytdl(song.url))
		.on('end', reason => {
			if (reason === 'O fluxo não está gerando com rapidez suficiente.') console.log('Canção terminada.');
			else console.log(reason);
			serverQueue.songs.shift();
			play(guild, serverQueue.songs[0]);
		})
		.on('error', error => console.error(error));
	dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);

	
}

client.login(TOKEN);
