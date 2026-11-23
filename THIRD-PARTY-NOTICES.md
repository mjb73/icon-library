# Third-party notices

Icon Library bundles artwork, fonts and Python wheels made by other people.
This file lists them and the licences they are redistributed under. The app's
own code is MIT (see `LICENSE`).

## Icon collections

All 127,374 icons come from [Iconify](https://iconify.design) collection
packages, stored in `data/icons.db`. Each collection keeps its own licence;
icons are redistributed under those terms and the composer writes the
per-icon licence into every export's `LICENSE.txt`.

| Collection | Prefix | Icons | Licence | Author | Licence URL |
| --- | --- | ---: | --- | --- | --- |
| Akar Icons | `akar-icons` | 454 | MIT | Arturo Wibawa | https://github.com/artcoholic/akar-icons/blob/master/LICENSE |
| Basil | `basil` | 493 | CC-BY-4.0 | Craftwork | https://creativecommons.org/licenses/by/4.0/ |
| Bootstrap Icons | `bi` | 2,078 | MIT | The Bootstrap Authors | https://github.com/twbs/icons/blob/main/LICENSE.md |
| Boxicons | `boxicons` | 3,768 | MIT | Boxicons | https://github.com/box-icons/boxicons-core/blob/main/LICENSE |
| Carbon | `carbon` | 2,631 | Apache-2.0 | IBM |  |
| Clarity | `clarity` | 1,103 | MIT | VMware | https://github.com/vmware/clarity-assets/blob/master/LICENSE |
| Codicons | `codicon` | 655 | CC-BY-4.0 | Microsoft Corporation | https://github.com/microsoft/vscode-codicons/blob/main/LICENSE |
| Devicon | `devicon` | 1,063 | MIT | konpa | https://github.com/devicons/devicon/blob/master/LICENSE |
| Fluent UI System Icons | `fluent` | 19,900 | MIT | Microsoft Corporation | https://github.com/microsoft/fluentui-system-icons/blob/main/LICENSE |
| Font Awesome 6 Regular | `fa6-regular` | 163 | CC-BY-4.0 | Dave Gandy | https://creativecommons.org/licenses/by/4.0/ |
| Font Awesome 6 Solid | `fa6-solid` | 1,402 | CC-BY-4.0 | Dave Gandy | https://creativecommons.org/licenses/by/4.0/ |
| Game Icons | `game-icons` | 4,133 | CC-BY-3.0 | GameIcons | https://github.com/game-icons/icons/blob/master/license.txt |
| HeroIcons | `heroicons` | 1,288 | MIT | Refactoring UI Inc | https://github.com/tailwindlabs/heroicons/blob/master/LICENSE |
| Huge Icons | `hugeicons` | 6,065 | MIT | Hugeicons |  |
| Iconoir | `iconoir` | 1,671 | MIT | Luca Burgio | https://github.com/iconoir-icons/iconoir/blob/main/LICENSE |
| IonIcons | `ion` | 1,357 | MIT | Ben Sperry | https://github.com/ionic-team/ionicons/blob/main/LICENSE |
| Lucide | `lucide` | 1,903 | ISC | Lucide Contributors | https://github.com/lucide-icons/lucide/blob/main/LICENSE |
| Material Design Icons | `mdi` | 7,447 | Apache-2.0 | Pictogrammers | https://github.com/Templarian/MaterialDesign/blob/master/LICENSE |
| Material Design Light | `mdi-light` | 284 | OFL-1.1 | Pictogrammers | https://github.com/Templarian/MaterialDesignLight/blob/master/LICENSE.md |
| Material Symbols | `material-symbols` | 15,728 | Apache-2.0 | Google | https://github.com/google/material-design-icons/blob/master/LICENSE |
| Material Symbols Light | `material-symbols-light` | 15,793 | Apache-2.0 | Google | https://github.com/google/material-design-icons/blob/master/LICENSE |
| MingCute Icon | `mingcute` | 3,320 | Apache-2.0 | MingCute Design | https://github.com/Richard9394/MingCute/blob/main/LICENSE |
| Octicons | `octicon` | 774 | MIT | GitHub | https://github.com/primer/octicons/blob/main/LICENSE |
| Phosphor | `ph` | 9,072 | MIT | Phosphor Icons | https://github.com/phosphor-icons/core/blob/main/LICENSE |
| Remix Icon | `ri` | 3,188 | Apache-2.0 | Remix Design | https://github.com/cyberalien/RemixIcon/blob/master/License |
| Simple Icons | `simple-icons` | 3,466 | CC0-1.0 | Simple Icons Collaborators | https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md |
| Solar | `solar` | 8,706 | CC-BY-4.0 | 480 Design | https://creativecommons.org/licenses/by/4.0/ |
| SVG Logos | `logos` | 2,016 | CC0-1.0 | Gil Barbara | https://raw.githubusercontent.com/gilbarbara/logos/master/LICENSE.txt |
| Tabler Icons | `tabler` | 6,238 | MIT | Paweł Kuna | https://github.com/tabler/tabler-icons/blob/master/LICENSE |
| Unicons | `uil` | 1,215 | Apache-2.0 | Iconscout | https://github.com/Iconscout/unicons/blob/master/LICENSE |

CC-BY collections (Solar, Font Awesome 6, Game Icons, Codicons, Basil) require
attribution when their artwork is redistributed; the export's `LICENSE.txt`
carries the collection, author and licence for exactly that reason.

Trademarks: `logos` and `simple-icons` are released under CC0, which covers
copyright only. Company names and logos remain trademarks of their owners and
are provided for identification, not endorsement.

## Fonts

Label fonts are bundled in `static/fonts/label/` and served to the page, so the
app needs no system font installs on Windows, macOS or Linux. The 20 display/
script/pixel families come from Google Fonts; the other 20 are common open
desktop families (DejaVu, Liberation, Noto, Fira Sans, Open Sans, Cantarell,
Adwaita, Hack, Fantasque Sans Mono). Per-family licence texts are in
`static/fonts/label/licenses/`.

UI fonts in `static/fonts/ui/` (Chakra Petch, Space Grotesk, JetBrains Mono,
Syne, DM Sans, Quicksand, Nunito, Space Mono, Kanit, Barlow) are also from
Google Fonts, SIL Open Font License 1.1; see `static/fonts/ui/licenses/`.

## Python packages

Wheels in `vendor/wheels/` are unmodified PyPI releases, installed offline:
FastAPI (MIT), Starlette (BSD-3-Clause), Pydantic (MIT), Uvicorn (BSD-3-Clause),
Pillow (MIT-CMU), fontTools (MIT), AnyIO (MIT), Click (BSD-3-Clause), h11 (MIT),
idna (BSD-3-Clause), typing-extensions and typing-inspection (PSF/MIT). Each
wheel keeps its own licence and metadata; see the `*.dist-info` inside.
