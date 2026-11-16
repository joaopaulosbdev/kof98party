#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <emscripten.h>

#include "burner.h"
#include "fbheadless.h"

extern "C" {

EMSCRIPTEN_KEEPALIVE
int fbw_init(void)
{
    int rc = FBHeadlessInit();
    FBHeadlessSetRomPath("/roms/");
    return rc;
}

EMSCRIPTEN_KEEPALIVE
void fbw_set_rom_path(const char* path)
{
    FBHeadlessSetRomPath(path ? path : "/roms/");
}

EMSCRIPTEN_KEEPALIVE
int fbw_load(const char* shortName)
{
    return FBHeadlessLoadDriver(shortName ? shortName : "kof98h");
}

EMSCRIPTEN_KEEPALIVE
void fbw_frame(int draw)
{
    FBHeadlessRunFrame(draw);
}

EMSCRIPTEN_KEEPALIVE
void fbw_reset(void)
{
    FBHeadlessReset();
}

EMSCRIPTEN_KEEPALIVE
void fbw_exit(void)
{
    FBHeadlessExit();
}

EMSCRIPTEN_KEEPALIVE
int fbw_get_width(void)
{
    return FBHeadlessGetVideoWidth();
}

EMSCRIPTEN_KEEPALIVE
int fbw_get_height(void)
{
    return FBHeadlessGetVideoHeight();
}

EMSCRIPTEN_KEEPALIVE
int fbw_get_fps(void)
{
    return FBHeadlessGetFrameRate();
}

// Converts FBHeadless 0x00RRGGBB (XRGB8888) into 0xAABBGGRR (RGBA8888 little-endian for Canvas ImageData)
EMSCRIPTEN_KEEPALIVE
void fbw_copy_rgba(uint32_t* dst)
{
    const uint32_t* src = (const uint32_t*)FBHeadlessGetVideoBuffer();
    if (!src || !dst) return;
    const int count = FBHeadlessGetVideoWidth() * FBHeadlessGetVideoHeight();
    for (int i = 0; i < count; i++) {
        uint32_t px = src[i];
        dst[i] = 0xFF000000u | ((px & 0xFFu) << 16) | (px & 0xFF00u) | ((px >> 16) & 0xFFu);
    }
}

EMSCRIPTEN_KEEPALIVE
int fbw_get_audio_rate(void)
{
    return FBHeadlessGetAudioSampleRate();
}

EMSCRIPTEN_KEEPALIVE
int fbw_get_audio_frames(void)
{
    return FBHeadlessGetAudioFrames();
}

EMSCRIPTEN_KEEPALIVE
const short* fbw_get_audio_buffer(void)
{
    return FBHeadlessGetAudioBuffer();
}

EMSCRIPTEN_KEEPALIVE
void fbw_set_input(int player, int button, int value)
{
    FBHeadlessSetInput(player, button, value);
}

EMSCRIPTEN_KEEPALIVE
void fbw_set_input_mask(int player, uint32_t mask)
{
    static const int btns[] = {
        FBHeadlessButtonUp,
        FBHeadlessButtonDown,
        FBHeadlessButtonLeft,
        FBHeadlessButtonRight,
        FBHeadlessButton1,
        FBHeadlessButton2,
        FBHeadlessButton3,
        FBHeadlessButton4,
        FBHeadlessButtonStart,
        FBHeadlessButtonCoin,
    };
    for (int i = 0; i < (int)(sizeof(btns) / sizeof(btns[0])); i++) {
        FBHeadlessSetInput(player, btns[i], (mask >> i) & 1u);
    }
}

EMSCRIPTEN_KEEPALIVE
uint32_t fbw_ram_hash(void)
{
    static unsigned char ramBuf[0x10000];
    unsigned int read = FBHeadlessReadAchievementMemory(0, ramBuf, sizeof(ramBuf));
    uint32_t h = 2166136261u;
    for (unsigned int i = 0; i < read; i++) {
        h ^= ramBuf[i];
        h *= 16777619u;
    }
    return h;
}

EMSCRIPTEN_KEEPALIVE
int fbw_save_state(const char* path)
{
    return FBHeadlessSaveState(path);
}

EMSCRIPTEN_KEEPALIVE
int fbw_load_state(const char* path)
{
    return FBHeadlessLoadState(path);
}

EMSCRIPTEN_KEEPALIVE
int fbw_set_dip(int group, int option)
{
    return setDIPSwitchOption(group, option) ? 0 : 1;
}

} // extern "C"
