# GTA VI Twitch Viewer Forecast

Local candidate for make.fun's "Forecast GTA VI's launch-day Twitch viewers hour by hour" bounty.

`main.ts` reads every `.in` case in `MAKEFUN_INPUT_DIR` (default `/input`) and writes one `.out` JSON forecast per case to `MAKEFUN_OUTPUT_DIR` (default `/output`). It uses the supplied launch-comparison curves and emits five ordered quantiles for hours 2–24.

This is a local draft. It has not been uploaded or submitted to make.fun.
