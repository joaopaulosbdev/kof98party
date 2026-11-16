# The King of Fighters '98 — WebAssembly (FBNeo)

Port WebAssembly do driver Neo Geo do **FinalBurn Neo** (`headless` + Musashi M68000 + Z80 + YM2610) para executar *The King of Fighters '98* diretamente no navegador.

> **Nota:** Este repositório não inclui ROMs nem arquivos de BIOS protegidos por direitos autorais (`kof98.zip`, `neogeo.zip`).

## Como executar

1. Coloque seus arquivos `kof98.zip` e `neogeo.zip` na raiz do projeto (ou selecione-os diretamente pela interface web caso esteja usando GitHub Pages / servidor sem as ROMs).
2. Inicie um servidor HTTP local (necessário para `fetch()` e carregamento do `.wasm`):
   ```bash
   node serve.mjs
   ```
3. Abra `http://127.0.0.1:8080/` no navegador e clique em **Iniciar Jogo**.

## Controles padrão

- **Jogador 1**: `WASD` ou `Setas` (mover), `U/I/J/K` ou `Z/X/C/V` (A/B/C/D), `5` (Ficha), `1` ou `Enter` (Start), `F2` (Test Menu).
- **Jogador 2**: `Numpad 8/4/2/6` (mover), `Numpad 7/9/1/3` (A/B/C/D), `6` (Ficha), `2` (Start).
- **Gamepad**: controles USB/Bluetooth são detectados automaticamente pela Gamepad API.

## Recompilando o WebAssembly

Para recompilar `wasm/kof98_fbneo.js` e `wasm/kof98_fbneo.wasm`, tenha o código-fonte do FinalBurn Neo em `FBNeo-master/`, Perl e Emscripten SDK (`emsdk`), ajuste os caminhos em `wasm/build.mjs` se necessário e execute:

```bash
node wasm/build.mjs
```
