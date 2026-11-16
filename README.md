# KOF '98 Party — WebAssembly Online (FBNeo)

Jogue **The King of Fighters '98** diretamente no navegador com **WebAssembly (FinalBurn Neo)**, download automático do jogo com cache local e **salas multiplayer online (P2P WebRTC)** por código ou link de convite.

## Recursos

- **Download automático + Cache no navegador**: ao clicar em **Jogar Agora**, **Criar Sala** ou **Entrar na Sala**, `neogeo.zip` e `kof98.zip` são baixados automaticamente com barra de progresso e salvos no `Cache API` do navegador.
- **Lobby Online P2P (WebRTC / PeerJS)**:
  - **Criar Sala (Lobby)**: gera um código curto (ex.: `KOF-7A3F`) e um link direto `?room=KOF-7A3F` para enviar aos amigos, sem precisar de servidor backend (compatível com GitHub Pages).
  - **Modo Sync P2P (Inputs)**: ambos rodam o emulador localmente com imagem nítida, delay configurável (`1f`–`6f`), sincronização inicial via save state e verificação automática de hash anti-dessincronização.
  - **Modo Stream P2P (Vídeo + Áudio)**: o host transmite vídeo a 60 FPS e áudio via WebRTC enquanto o convidado envia comandos de P2.
  - **Chat na sala** e indicador de **Ping (ms)** em tempo real.
- **Controles**: Teclado (P1 e P2), Gamepad USB/Bluetooth (Gamepad API) e botões na tela para dispositivos móveis.

## Como rodar localmente

```bash
node serve.mjs
```

Acesse `http://127.0.0.1:8080/` no navegador.

## Recompilando o WebAssembly

Com o código-fonte do FinalBurn Neo em `FBNeo-master/`, Perl e Emscripten SDK (`emsdk`) instalados:

```bash
node wasm/build.mjs
```
