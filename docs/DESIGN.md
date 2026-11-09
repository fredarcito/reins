# Harness para agentes de código: diseño completo (borrador para opiniones)

Nov 4, 2026 · @Freddy

## Estado del diseño

Es solo un diseño: no hay código ni mediciones. El ahorro de tokens y la mejora de calidad son hipótesis, y lo único que una máquina hace cumplir es el `check` de arquitectura con su hook de git y su CI.

- **Más confianza:** la parte determinista (arquitectura por `check`, hook de git, CI y branch protection).
- **Menos confianza:** todo lo que depende de que el agente escriba o lea archivos (triaje, libreta, notas, políticas, skills, agentes). Es instrucción y puede ignorarse.
- **Sin verificar:** lo que se cita de herramientas externas (hooks, permisos, skills y subagentes de Claude Code) viene de memoria y debe comprobarse antes de construir encima.

## Contexto y objetivo

Queremos que los agentes de código respeten la arquitectura de cada proyecto, gasten menos tokens y no pierdan el contexto ni las decisiones, y que el sistema sobreviva a un cambio de modelo o de herramienta.

**Equipo y herramientas**

- Equipo pequeño con varios repos de frontend (Vite + React y Next). El backend es Rails, en otro repo.
- Todos usan Claude Code, pagado por la empresa. Algunos usan también Codex, y alguien podría usar Cursor con otro modelo si se acaban los tokens.
- Distribución prevista: paquete en npm público y open source en GitHub. Fase 1 solo JS (Vite y Next); Ruby/Rails queda para una fase 2.

**Restricciones de flujo (vienen de cómo trabaja el usuario)**

- El agente nunca hace commit, push ni PR. La persona revisa el código y hace el commit.
- No se ejecutan tests por subtarea. La verificación pesada se hace una sola vez, al final.
- El agente no pide revisión por cada subtarea. Solo se detiene en casos justificados.
- Las tareas pequeñas no deben pagar ceremonia.

**Caso de uso que motivó parte del diseño**

Auditorías de optimización: se pide "revisa todo el proyecto", aparecen unas 10 mejoras, se hacen 3 por otra prioridad, y semanas después se repite el mismo prompt desde cero.

## Principios de diseño

1. **Lo que se puede comprobar lo hace cumplir una herramienta.** Lo demás se resuelve con notas cortas en markdown.
2. **Portabilidad por capas.** El valor vive en un núcleo que no depende de ningún agente; el contenido es markdown plano; los adaptadores por herramienta son finos y sin lógica propia.
3. **Cada pieza se paga solo si la tarea la necesita.** Lo pequeño no paga nada.
4. **Casi todo es opcional.** Si una pieza no aporta en el piloto, se borra sin romper el resto.

## Capas y ejes de extensión

El diseño tiene tres capas, de más a menos duradera, y cuatro ejes por los que puede crecer.

**Tres capas**

| Capa | Qué contiene | Qué la sostiene |
| --- | --- | --- |
| 1. Núcleo | `architecture.yml`, `baseline.json`, comando `check`, hook de git, CI | Node + git; no depende de ningún agente |
| 2. Contenido en markdown | `AGENTS.md`, notas, políticas, skills, agentes, checklist | Es texto portable, independiente del proveedor |
| 3. Adaptadores de herramienta | `.claude/` (opcional), Husky | Archivos finos sin lógica que solo llaman al CLI; se generan con `reins sync` |

**Cuatro ejes de extensión** (solo el primero se formaliza en la fase 1)

| Eje | Pregunta que responde | Mecanismo |
| --- | --- | --- |
| Lenguaje o framework | ¿Cómo leo las dependencias? | Adaptadores `packages/adapters/<x>` con contrato mínimo versionado |
| Herramienta de agente | ¿Cómo le llegan las reglas? | Base común en `AGENTS.md` y adaptadores opcionales por cliente |
| Qué se valida | ¿Qué compruebo? | Checks de herramienta o de agente (por ejemplo stylelint para CSS) |
| Contenido | ¿Qué sabe y hace el agente? | Markdown en `.harness/` (notas, políticas, skills, agentes) |

Los tres últimos ejes no se formalizan con contrato hasta que aparezca el segundo caso real de cada uno.

## Estructura de carpetas

Hay dos estructuras distintas: el paquete open source (el motor, que se construye una vez) y lo que queda instalado en cada repo del equipo.

**1. El paquete (monorepo open source)**

```
harness/
├── packages/
│   ├── core/                      @harness/core · agnóstico, no conoce ningún framework
│   │   └── src/
│   │       ├── check/             reglas de arquitectura, baseline, integridad
│   │       ├── doctor/            reglas de proceso (locales, informativas)
│   │       ├── report/            formato común de mensajes (regla, motivo, arreglo) + JSON
│   │       ├── config/            lee y valida architecture.yml
│   │       ├── notes/             resolver ruta → nota
│   │       └── contract/          tipos y versión del contrato del adaptador
│   ├── cli/                       @harness/cli · init, check, doctor, notes, sync, audit, review, scope
│   │   └── src/commands/
│   └── adapters/
│       └── js/                    @harness/adapter-js · el único de la fase 1
│           ├── src/               detect.js · graph.js · aliases.js
│           ├── presets/           vite-react.yml · next-app.yml · next-pages.yml
│           └── rules/             next-server-client.js (opcional, solo Next)
├── templates/                     plantillas de nota, progreso, skills y agentes
├── examples/                      vite-react/ · next-app/ (un repo de prueba por preset)
├── docs/                          adapter-contract.md · architecture-yml.md
├── pnpm-workspace.yaml            packages/* y packages/adapters/*
└── .github/workflows/             tests del motor contra examples/
```

**2. Lo que queda en cada repo del equipo**

```
AGENTS.md                      comandos, reglas de oro, índice ruta → nota (generado)
CLAUDE.md                      una línea: @AGENTS.md

.harness/
├── architecture.yml           adapters: [js] · preset · capas · dominios · reglas · excepciones
├── baseline.json              violaciones existentes congeladas
├── doctor.yml                 umbrales del doctor (separados del plano)
├── notes/<módulo>.md          frontmatter: paths (en git)
├── policies/
│   ├── triage.md              política de triaje (en git)
│   ├── progress.md            libreta y verificación (bajo demanda)
│   └── multiagent.md          varios agentes (bajo demanda, solo nivel grande)
├── skills/                    fuente de las skills (en git)
│   ├── audit/SKILL.md
│   └── close-task/SKILL.md
├── agents/                    fuente de los agentes (en git)
│   └── reviewer.md            explorer.md se añade después
├── review/checklist.md
├── templates/progress.md
├── hooks/pre-commit.sh        una línea: harness check
├── backlog/                   LOCAL (.gitignore): hallazgos de auditorías
│   └── optimizaciones.md
└── progress/                  LOCAL (.gitignore)
    ├── triage.log             una línea por tarea
    └── <rama>/<tarea>/        una carpeta por tarea: notebook.md (libreta caliente) y la fría (decisiones, verificación, entrega, informes de agentes)

.claude/                       generado desde .harness/, sin lógica propia
├── settings.json              hooks → harness check / harness notes; permisos que deniegan git commit/push
├── agents/                    envoltorios de .harness/agents/
└── skills/                    envoltorios de .harness/skills/

.husky/pre-commit              llama a .harness/hooks/pre-commit.sh
.github/workflows/harness.yml  job de CI (la garantía real)
.gitignore                     incluye .harness/backlog/ y .harness/progress/
```

**Qué va en git y qué no**

| Ruta | ¿En git? | Por qué |
| --- | --- | --- |
| `architecture.yml`, `baseline.json`, `doctor.yml`, `notes/`, `policies/`, `skills/`, `agents/`, `review/`, `templates/`, `hooks/` | Sí | Fuente compartida |
| `backlog/`, `progress/` | No | Estado personal y temporal |
| `.claude/`, `AGENTS.md`, `CLAUDE.md`, `.husky/`, workflow | Sí | Adaptadores y mínimo común; se regeneran desde `.harness/` |

No hay `AGENTS.md` ni `CLAUDE.md` por carpeta de módulo: añaden ruido, y las notas se centralizan en `.harness/notes/`.

## Núcleo determinista

Es la parte que se hace cumplir con herramientas. No depende del agente ni del modelo.

### `architecture.yml`

Define capas (cada una solo importa de las inferiores), dominios con su API pública, reglas y excepciones permanentes justificadas. Ejemplo:

```yaml
version: 1
adapters: [js]
preset: next-app

layers:
  - { name: pages,      paths: ["src/pages/**", "src/app/**"] }
  - { name: features,   paths: ["src/features/**"] }
  - { name: components, paths: ["src/components/**"] }
  - { name: shared,     paths: ["src/hooks/**", "src/utils/**", "src/lib/**"] }

domains:
  billing: { paths: ["src/features/billing/**"], public_api: ["src/features/billing/index.js"] }
  search:  { paths: ["src/features/search/**"],  public_api: ["src/features/search/index.js"] }

rules:
  - { id: layer-direction, severity: error,
      message: "{from} importa de {to}, pero esa capa está por encima.",
      fix: "Mueve la lógica compartida a una capa inferior o inviértela con props/callbacks." }
  - { id: domain-boundary, severity: error,
      message: "Importas internals de {domain}.",
      fix: "Importa desde el index del dominio." }
  - { id: no-cycles, severity: error }

allow:
  - { from: "src/features/search/**", to: "src/features/billing/**",
      reason: "El buscador muestra precios; decisión de 2026-11" }
```

### `harness check`

- **Reglas:** `layer-direction`, `domain-boundary` y `no-cycles`. Más integridad: nadie edita `baseline.json` ni `architecture.yml` sin que se note, y los archivos generados no divergen de su fuente (`sync --check`).
- **Errores útiles para un agente:** dicen qué regla se rompió, por qué y cómo arreglarlo, con salida legible y en JSON.
- **Baseline:** `baseline.json` congela las violaciones existentes. El `check` nace en verde y solo falla con violaciones nuevas.
- **Cuándo corre:** en el hook de pre-commit (solo archivos tocados, rápido) y en la CI (proyecto completo). Bloquea.
- **Debilidad conocida:** el hook se puede saltar con `--no-verify`. Por eso la CI es la garantía real, junto con branch protection (PR con aprobación humana y el job en verde).

### `harness init`

Escanea el repo, calcula el grafo con una herramienta existente (dependency-cruiser o madge), infiere las capas por la dirección dominante de dependencias, propone dominios (cada subcarpeta de `features/`), genera el baseline y entrega un informe para revisar con capas inferidas, ciclos existentes y dependencias dudosas.

**Limitación:** el código dice lo que existe, no lo que debería existir. Si el repo está desordenado, el borrador describe el desorden. La arquitectura deseada la decide una persona. Un agente puede ayudar a interpretar el informe, pero el grafo lo calcula la herramienta.

### Adaptadores de lenguaje

Contrato mínimo y versionado (`contract: 1`):

```js
export default {
  name: "js",
  contract: 1,
  detect(repoPath) {},            // ¿aplica a este repo?
  graph(repoPath, config) {}      // devuelve [{ from, to, kind }]
}
```

Más una carpeta `presets/`. El núcleo solo ve aristas "A depende de B" y nunca abre un `.js` ni un `.rb`. Todo lo específico (imports, alias `@/`, Zeitwerk en Rails) vive dentro del adaptador.

- **Fase 1:** solo `adapter-js`, con presets Vite + React, Next app router y Next pages router, y una regla opcional server/client de Next. Los alias son la fuente de bugs más probable, por eso `examples/` tiene un repo de prueba por preset.
- **Fase 2, Ruby:** adaptador aparte que envolvería Packwerk (una gema que debe estar en el Gemfile; el adaptador solo la ejecuta). El modelo de capas encaja peor en Rails, que se organiza más por dominios, así que el contrato podría necesitar ajustes cuando llegue el segundo adaptador.
- **El núcleo no puede conocer ningún framework.** Un `if (next)` en el núcleo rompería el diseño.

### Empaquetado y distribución

- **Nombres npm:** `@harness/core`, `@harness/cli`, `@harness/adapter-js`. Adaptadores externos: `harness-adapter-<nombre>` con la keyword `harness-adapter`, en sus propios repos. Pendiente: comprobar si el scope `@harness` está libre (probablemente no).
- **Dependencias:** los adaptadores declaran `@harness/core` como `peerDependency` y llevan `"harness": { "contract": 1 }` en su `package.json`.
- **Instalación por separado:** los adaptadores no son dependencias del CLI (`npm i -D @harness/cli @harness/adapter-js`). Si falta uno, el CLI dice cuál instalar. Las dependencias pesadas (dependency-cruiser) viven dentro de cada adaptador, así que en un proyecto JS no se instala nada de Ruby.
- **Dirección de dependencias:** `core` no importa de `cli` ni de `adapters`. Los adaptadores solo ven `@harness/core/contract`, lo que impone el campo `exports`. El propio repo se valida con su `check`; al inicio, un script con dependency-cruiser cubre el problema de huevo y gallina.
- **`harness init` sugiere el adaptador** que falta; no lo instala.

## `harness doctor`: reglas de proceso

El `doctor` está separado del `check` porque da otra garantía: el `check` asegura que lo que entra a git cumple las reglas; el `doctor` informa de cómo va el flujo de trabajo local.

|  | `harness check` | `harness doctor` |
| --- | --- | --- |
| Garantiza | Que lo que entra a git cumple las reglas | Cómo va el flujo local |
| Mira | Solo lo que está en git | `progress/`, `triage.log` y el diff |
| Resultado | Determinista; bloquea (`error`) | Informativo (`warn`); código 0 salvo `--strict` |
| Corre en | Hook de commit y CI | Máquina local; el agente al cerrar la tarea. Nunca en CI |
| Baseline | Sí | No |
| Adaptador de lenguaje | Sí | No |

**Regla para ubicar una regla nueva:** si depende solo de lo que está en git y debe poder bloquear un merge, va al `check`. Si no, va al `doctor`.

**Reglas del `doctor`**

| Regla | Avisa si |
| --- | --- |
| `triage-mismatch` | El diff de la tarea actual supera los umbrales del nivel declarado en `triage.log` |
| `triage-missing` | Hay diff sin línea en `triage.log` |
| `agents-size` | `AGENTS.md` pasa del tope de líneas |
| `progress-hot-size` | El archivo caliente de la libreta pasa del tope |
| `progress-format` | Hay más de una `[~]`, un marcador inválido o una `[-]` sin motivo |
| `progress-closed` | `estado: cerrada` con criterios sin marcar |

Los umbrales viven en un archivo aparte, porque son valores iniciales sin calibrar y conviene moverlos sin tocar el plano de arquitectura:

```yaml
# .harness/doctor.yml
triage:
  pequeña: { max_files: 3, max_domains: 1 }
  media:   { max_domains: 1 }
agents_md: { max_lines: 45 }
progress:  { hot_max_lines: 40 }
```

Comparte con el `check` el formato de error (regla, motivo, arreglo). Orden de construcción previsto: primero `triage-mismatch` y `triage-missing`, que generan datos para el piloto, y el resto cuando el piloto muestre que el agente las rompe.

## Contenido que lee el agente

Todo lo de esta sección es contenido en markdown. Es una instrucción: el agente puede ignorarla, y por eso lo que debe cumplirse siempre vive en el `check`.

### `AGENTS.md`: mapa corto

Tope de unas 45 líneas, con divulgación progresiva: lo que se necesita siempre, y punteros a lo demás.

```markdown
# <Proyecto>
Comandos: `npm run dev` · `npm test` · `harness check`

## Siempre
- Antes de actuar, di en una línea el nivel de la tarea y el motivo (ver `.harness/policies/triage.md`). Si el prompt empieza con [rápido] o [a fondo], manda esa indicación y no anuncies nada.
- Nunca hagas commit, push ni PR. Deja los cambios sin commitear.
- No uses `--no-verify`.
- Al cerrar, corre `harness check` y `harness doctor`, y di qué verificaste, qué avisos quedaron y qué no verificaste.
- Detente solo si hay una decisión ambigua con consecuencias, el alcance crece, la acción es irreversible o fallas varias veces seguidas.

## Bajo demanda
- Tarea media o grande → lee `.harness/policies/progress.md`.
- Varios agentes (solo grande) → lee `.harness/policies/multiagent.md`.
- Antes de tocar estas rutas, lee su nota: <índice ruta → nota, generado por `harness sync`>
```

`CLAUDE.md` solo lo importa (`@AGENTS.md`). No hay `AGENTS.md` ni `CLAUDE.md` por carpeta de módulo.

### Notas por módulo

Decisiones, trampas e invariantes de una o dos líneas con fecha, solo en los módulos con más cambios. La fuente está en `.harness/notes/<módulo>.md` con las rutas (`paths`) en el frontmatter.

Llegan al agente por dos vías:

- **Índice en `AGENTS.md`:** agnóstico a la herramienta, pero depende de que el agente lo siga.
- **Hook `PreToolUse` en Claude Code** que llama a `harness notes <ruta>` y entrega la nota al editar. Sin verificar que el evento funcione así.

Las notas con fecha envejecen, así que se prevé avisar de las que no se tocan mientras el código del módulo sí cambia. Los `wontfix` con motivo duradero de las auditorías pasan a la nota del módulo.

### Política de triaje (`policies/triage.md`)

Tres niveles. Decide el agente con su juicio y la política, y la persona puede cambiarlo.

Una tarea es lo que requiere leer el repo, ejecutar un comando o cambiar un archivo. Los mensajes solo informativos (una pregunta que se responde con lo que ya está en la conversación, una confirmación del flujo) no son tareas: sin nivel, sin anuncio y sin línea en `triage.log`, para no meter ruido en la conversación. Una pregunta que requiere trabajo en el repo (una revisión o investigación, aunque no cambie archivos) sí es tarea.

| Nivel | Señal | Qué hace |
| --- | --- | --- |
| Pequeña | Archivo o función nombrados; cambio acotado | Lee solo ese archivo y su nota. No explora. Sin libreta. |
| Media | Un dominio, varios archivos, sin decisiones de arquitectura nuevas | Usa el índice de notas, busca dentro del dominio y resume en dos líneas antes de editar. Libreta mini. |
| Grande | Varios dominios, feature nueva, refactor, cambio de contrato, migración o "revisa todo" | Escribe criterios de terminado, usa el explorer (solo lectura), presenta plan y espera confirmación. Libreta completa. |

- **Override explícito (prioridad máxima):** `[rápido]` o `/quick` = pequeña; `[a fondo]` o `/plan` = grande.
- **Anuncio del nivel:** una línea con nivel y motivo antes de actuar. Pequeña y media continúan sin esperar; grande presenta el plan y espera confirmación; con `[rápido]` no se anuncia. Si el nivel cambia durante la tarea, se avisa en una línea.
- **Cuando duda:** elige el nivel menor y lo dice ("media, pero podría ser grande si aparece otro dominio").
- **Señales objetivas** (con `harness scope <rutas>`, comando previsto y aún no construido): 1 dominio y 3 archivos o menos = pequeña; 1 dominio y más de 3 = media; 2 dominios o más, o toca `architecture.yml` o una API pública = grande.
- **Escalada a mitad de tarea:** una pequeña o media debe parar y proponer subir de nivel si aparece un segundo dominio, se superan los umbrales, hay que modificar una API pública, una regla o el baseline, o el `check` falla por algo imprevisto. No se sube de nivel "por precaución".
- **Registro:** al anunciar, el agente ejecuta `reins triage <nivel> "<motivo>"`, que añade a `progress/triage.log` la línea `fecha | rama | nivel | motivo | commit:<sha>` (y `| task:<nombre>` si la tarea tiene libreta). El commit es HEAD al empezar: el ancla de la tarea. El `doctor` compara el diff de la tarea (desde ese commit, más lo no commiteado) con el nivel más alto de las líneas ancladas en ese mismo commit (comparten el diff no commiteado; así una tarea pequeña o de solo lectura después de una grande no da un `triage-mismatch` falso; con empate cita la línea más reciente). Sin commit en la última línea (escrita a mano o por una versión vieja) o si el commit ya no es ancestro de HEAD (rebase), vuelve a lo anterior: el diff de la rama contra la base y el nivel más alto de la rama. `resume` borra en silencio las líneas de ramas que ya no existen (ni local ni remote-tracking) y las de tareas cuyo trabajo ya está en la base (hay commits desde el ancla y todos están en la base). Sirve también para medir el piloto sin anotar a mano.
- **Punto más frágil:** que el agente clasifique bien. Mitigaciones: anuncio corregible, override, escalada y `triage-mismatch`.
- **Descartado:** un agente delegador separado. Gasta tokens para decidir si gastar tokens, falla en ambos sentidos y es un orquestador encubierto.

### Libreta de progreso (`policies/progress.md`)

Escala con el nivel de triaje. Es local, fuera de git y **una por tarea** (`progress/<rama>/<tarea>/notebook.md`): en una rama puede haber varias tareas, seguidas o en sesiones paralelas. Diseño completo: [`proposals/multi-session-progress.md`](proposals/multi-session-progress.md) (fase 1 construida el 2026-11-08).

| Nivel | Libreta |
| --- | --- |
| Pequeña | Ninguna. Se hace el cambio y se entrega. |
| Media | Mini: una hoja corta (objetivo, criterios, subtareas, siguiente paso). |
| Grande | Completa: archivo caliente (lo que se lee al retomar, tope de 40 líneas) y, en la misma carpeta de la tarea, `decisions.md`, `verification.md`, `delivery.md` e informes de agentes. |

**Reglas**

- Al empezar, si existe, se lee y se retoma desde "Siguiente paso".
- Los criterios de terminado se escriben antes de editar, no al final.
- Se actualiza en silencio al terminar cada subtarea y antes de cambiar de tema, no "al final", porque el final a veces no llega.
- Subtareas: `[ ]` pendiente, `[~]` en curso (solo una), `[x]` escrita pero no probada, `[-]` descartada con motivo. Las descartadas no se borran, para no volver a proponerlas.
- Lo necesario para terminar se añade a la libreta. Una mejora que surge por el camino va al `backlog/`.
- La cabecera lleva `status: open|closed` y, escritos por reins, `task:` y `session:` (la última sesión que reclamó la tarea). Solo se cierra cuando la persona confirma, con `reins progress close`; lo duradero pasa antes a la nota del módulo.
- **Qué tarea es de cada sesión:** la explícita (`--task` o `REINS_TASK`); si no, la abierta cuyo `session:` es esta sesión (el id viene del hook, de `CLAUDE_CODE_SESSION_ID` o de `REINS_SESSION`). Si no hay, ninguna: una sesión nueva nunca toma una tarea en silencio; `resume` le lista las abiertas y el agente continúa una (con `--task`, que la reclama), crea otra o pregunta. Excepciones: sin id de sesión y una sola abierta, se usa esa, como antes; la vieja `<rama>.md` funciona como tarea sin nombre hasta que se cierra (sin migración).
- **Planificar en una sesión e implementar en otra** es el uso real más común de varias sesiones por tarea: la sesión que planifica crea la tarea y deja en "Next step" dónde está el plan; la que implementa la encuentra con `resume` y la continúa.
- **Cada sesión escribe solo su libreta.** `resume` muestra la propia entera y las demás abiertas en una o dos líneas (máximo 5); las cerradas, en una sola línea y solo si hay otras abiertas. Los solapes entre sesiones no tienen código: la política le dice al agente que pregunte a la persona.
- **Limpieza automática** en `resume`, con margen fijo de 7 días: una cerrada se borra a los 7 días de cerrarse o cuando su rama ya no existe; una abierta, solo si su rama ya no existe y no cambió en 7 días. Nunca se borra trabajo abierto de una rama viva.
- Carga: una línea en `AGENTS.md` como respaldo. Un hook de inicio de sesión sería lo ideal, pero ese evento está sin verificar.

Plantilla mini (nivel media):

```markdown
# <rama> · estado: abierta · actualizado: YYYY-MM-DD
**Objetivo:** una o dos líneas.
**Criterios de terminado:**
- [ ] ...
- [ ] `harness check` sin violaciones nuevas
**Subtareas:**
- [~] ...
- [ ] ...
**Siguiente paso:** ...
```

La plantilla caliente del nivel grande añade restricciones, subtareas con fecha y descartadas, y un puntero a la carpeta fría. Las preguntas abiertas van como una línea en `decisiones.md`.

### Verificación (una vez, al terminar)

- No se ejecutan tests por subtarea.
- Al terminar: `harness check`, `harness doctor` y los tests relacionados, una sola vez.
- Si una subtarea cambia un contrato compartido (la firma de un hook, props compartidas), se hace antes una comprobación barata (tipos o build).
- El cierre dice qué se verificó, qué avisos dio el `doctor`, cuántos criterios se cumplen y qué quedó sin verificar.
- Riesgo asumido: un error temprano se descubre tarde.

### Reglas de git

El agente nunca hace commit, push ni PR, ni usa `--no-verify`. Deja los cambios sin commitear con un resumen, los archivos tocados y por qué, y la verificación. Los subagentes tampoco hacen commit.

Se refuerza de dos formas:

- **Permisos de Claude Code** que denieguen `git commit` y `git push`. La sintaxis está sin verificar; en otros agentes queda solo la instrucción.
- **Branch protection en GitHub:** PR con aprobación humana y el job del `check` obligatorio. Así nada llega a `main` sin revisión, aunque se suba una rama.

### Varios agentes (`policies/multiagent.md`, solo nivel grande)

El patrón líder–implementador–revisor es solo para tareas grandes, no el flujo por defecto.

- **Líder (agente principal):** planifica y coordina; no edita mientras haya subagentes activos.
- **Implementadores:** uno por subtarea independiente, sin archivos ni dependencias en común.
- **Revisor:** lee el diff y el resultado del `check`; no edita.
- **Un archivo por agente:** cada subagente escribe su informe en la carpeta de la tarea, `progress/<rama>/<tarea>/<agente>_<subtarea>.md`, y devuelve solo una referencia (`done -> ruta`) por chat. El principal lee los informes y actualiza la libreta. Esto evita escrituras concurrentes y el "teléfono descompuesto". Idea tomada de un repo de ejemplo.
- Si las subtareas comparten archivos o dependen unas de otras, se hacen en serie. Si la tarea resulta pequeña, se baja de nivel.
- **Descartado como norma:** un agente por subtarea. Cada agente carga su propio contexto (varios arranques), las subtareas suelen depender unas de otras y complica la revisión. No hay datos de que ahorre tokens.

### Backlog de auditorías

`backlog/optimizaciones.md` es local y está fuera de git. Guarda los hallazgos con estado `[open]`, `[done]` o `[wontfix]`, más fecha, ruta y motivo. La skill `audit` lo lee, no repite lo ya registrado, **re-verifica los `open` contra el código actual** y añade solo lo nuevo. Puede auditar por dominio para gastar menos.

Decisión actual: solo local. Lo que merece trabajo del equipo va a tickets, y los `wontfix` con motivo duradero pasan a la nota del módulo. Si el equipo audita con frecuencia, se podría commitear una versión curada más adelante.

### Skills

Procedimientos repetibles en `.harness/skills/<nombre>/SKILL.md`. Se cargan bajo demanda según su descripción, así que son baratas en tokens. Candidatas: `audit`, `close-task` y, más adelante, `new-component` (convención de carpeta con `index.js`), `add-domain` y `css-review`. Si una skill necesita un script, es una llamada al CLI. Se generan a `.claude/skills/`.

Diferencia con el resto del contenido:

| Pieza | Responde a |
| --- | --- |
| Notas | ¿Qué hay que saber de este módulo? |
| Políticas | ¿Cómo me comporto siempre? |
| Skills | ¿Cómo se hace esta tarea paso a paso? |
| Agentes | ¿Quién lo hace, con qué permisos y en contexto aparte? |
| Checks | ¿Se cumple esto? |

### Agentes

Cada agente es un markdown en `.harness/agents/<nombre>.md` con cuatro cosas: rol, permisos (`read-only` o `can-edit`), cuándo se usa y qué devuelve. El subagente nativo de Claude Code es un envoltorio generado.

- Hoy solo `reviewer`.
- `explorer` (solo lectura, apoyado en dominios, notas y grafo) se añade cuando haga falta.
- En otras herramientas, el mismo markdown se referencia desde `AGENTS.md` o se ejecuta con `harness review` o `harness run`.

### Skills externas

Siguen funcionando con el harness. Ejemplo analizado: Impeccable, que trae una skill, un detector por CLI (`impeccable detect`), un hook y archivos propios.

- `sync` solo toca lo que generó el harness y nunca limpia `.claude/skills/` entera.
- Los nombres propios llevan prefijo para no chocar (por ejemplo `harness-audit`).
- El harness no aplica notas ni triaje a una skill externa, y sus hooks corren aparte.
- Idea futura: un bloque `extensions:` en `architecture.yml` para registrar versión y checks de terceros (por ejemplo `impeccable detect` como check `warn`). No se construye hasta tener el primer caso real.
- Riesgos de ese ejemplo, según su README: hooks que corren fuera de la aprobación del modelo, un modo que lanza otro CLI con permisos desactivados, telemetría y un `update` que cambia hooks sin revisión.

## Qué se hace cumplir y qué no

La distinción central: una máquina comprueba el núcleo, y todo lo demás es instrucción que el agente puede ignorar.

| Hecho cumplir por una máquina | Instrucción que el agente puede ignorar |
| --- | --- |
| `check` por hook de git y CI | Anuncio de triaje |
| `baseline.json` | Libreta de progreso y su cierre |
| Integridad de `architecture.yml`, `baseline.json` y archivos generados | Notas, políticas, skills y agentes |
| Branch protection (PR con aprobación humana y job en verde) | Backlog de auditorías |
| Permisos que deniegan `git commit` y `git push` (si la prueba sale bien) | Reglas de varios agentes |

El `doctor` está en medio: avisa, pero solo de lo que el agente escribió. Si el agente no registra el nivel o no actualiza la libreta, algunas reglas no tienen nada que comparar.

## Plan: pruebas, piloto y fases

1. **Probar lo no verificado** (cuestan horas):
   - que las notas por ruta lleguen por hook en Claude Code,
   - que se puedan denegar `git commit` y `git push` por permisos,
   - que las políticas "bajo demanda" se carguen cuando toca,
   - que los alias `@/` se resuelvan en Vite y en Next,
   - que `peerDependencies` funcione con el gestor del equipo.
2. **Nivel 1 en un solo repo, sin paquete ni monorepo:** `architecture.yml`, `baseline.json`, un script con dependency-cruiser, el hook, la CI y un `AGENTS.md` corto. Más `triage-mismatch` y `triage-missing` del `doctor`.
3. **Piloto de 2 o 3 semanas** con criterios decididos antes de empezar:
   - violaciones de arquitectura que llegan al PR, antes y después,
   - rondas de corrección por tarea,
   - veces que hay que reexplicar una tarea al volver,
   - aciertos y desajustes de triaje (`triage.log`),
   - tokens de arranque con y sin harness, y tokens gastados en mantener la libreta, medidos con un dashboard propio de consumo de Claude Code.

   Las métricas deben ser independientes del modelo para poder comparar herramientas. Y hay que definir de antemano qué resultado haría seguir, simplificar o abandonar cada pieza.
4. **Después, según el piloto:** notas, skills, `audit`, `reviewer`, el resto del `doctor`, comandos `harness progress done/add/next` (para no reescribir la libreta a mano), `harness scope` y subagentes.
5. **Fase 2:** extraer el motor a un paquete, formalizar contratos, abrir el open source y añadir Ruby/Packwerk, ajustando el contrato con el segundo adaptador.

## Fuera de alcance por ahora

Está diseñado o anotado, pero no se construye hasta que el piloto lo pida:

- Orquestador general y agentes por módulo.
- Base de datos de memoria.
- Un agente delegador, y un agente por subtarea como norma.
- Contrato de integración por agente y contrato de checks.
- Soporte de otros lenguajes (Ruby queda para la fase 2).
- Backlog compartido en git.
- Un `sync` que genere reglas de Cursor.

## Riesgos y dudas conocidos

- **Más diseño que evidencia.** Cada hueco que se tapó añadió una pieza, y el conjunto crece más rápido que lo que se ha probado.
- **Dependencia de que el agente escriba y lea archivos.** El `doctor` no ve lo que no se escribió.
- **Umbrales sin calibrar.** 3 archivos, 1 o 2 dominios, 30 y 40 líneas son números iniciales.
- **El triaje es el punto más frágil.** El ahorro de tokens depende de él, y podría ser negativo si `AGENTS.md`, las notas y la libreta cuestan más de lo que ahorran.
- **El `check` aplica el plano que se le dé,** incluso uno malo. La arquitectura deseada la decide una persona.
- **Sin decidir:** si los tres repos del equipo comparten un `architecture.yml` base o divergen; qué hacer con monorepos; cómo se actualiza el baseline (quién y con qué revisión).
- **Medición por herramienta.** Cursor y Codex no comparten los logs de tokens de Claude Code.
- **Formatos cambiantes.** Los formatos de reglas de los agentes cambian rápido, de ahí la capa 3 fina y desechable.
- **Seguridad:** hooks que corren fuera de la aprobación del modelo, permisos de subagentes y skills de terceros con su propio código.

## Referencias consideradas

- **Motor del `check`**, en vez de escribir uno propio: dependency-cruiser, madge, eslint-plugin-boundaries, Sheriff, los límites de módulos de Nx y ArchUnitTS. Para Rails, Packwerk y RuboCop. Citados de memoria; su estado actual está sin verificar.
- **Instrucciones por ruta:** el estándar `AGENTS.md` y las reglas de Cursor.
- **Repo de ejemplo de "harness engineering"** ([betta-tech/ejemplo-harness-subagentes](https://github.com/betta-tech/ejemplo-harness-subagentes)): líder, implementador y revisor, `feature_list.json`, `init.sh`, `CHECKPOINTS.md` y estado en disco. De ahí se tomaron el archivo por agente y los criterios de terminado. Se descartó usar el patrón multiagente por defecto.
- **Skill externa analizada:** [pbakaus/impeccable](https://github.com/pbakaus/impeccable), como ejemplo de skill con detector, hook y archivos propios.

## Preguntas para quienes den su opinión

1. ¿Hay demasiadas piezas para un equipo pequeño? ¿Qué quitarían antes de construir nada?
2. ¿Separar `check` (bloquea, en git) de `doctor` (informa, local) tiene sentido, o es sobreingeniería?
3. ¿El triaje con anuncio y contraste contra el diff es una buena forma de reducir tokens, o el costo de mantenerlo supera el ahorro?
4. ¿La libreta por niveles (ninguna, mini, completa; caliente y fría) cubre bien la pérdida de contexto por compactación y cambio de chat, o hay un enfoque más simple?
5. ¿Conocen herramientas que ya resuelvan buena parte de esto (arquitectura, memoria y agentes) y que valga la pena adoptar en lugar de construir?
6. ¿Qué métricas añadirían al piloto, y cómo medirían de forma fiable el ahorro de tokens?
7. ¿Cómo evitarían que el diseño siga creciendo antes de probarlo?
8. ¿Qué riesgos de seguridad o de proceso no se han visto (hooks, permisos, subagentes, skills de terceros)?
