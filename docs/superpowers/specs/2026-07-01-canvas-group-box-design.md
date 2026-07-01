# Canvas Group Box (Excalidraw-style frames)

## Problema

Canvas do agenthub (`AgentCanvas.tsx`) não tem forma de agrupar nós/widgets relacionados visualmente. Usuário quer um retângulo com título ("assunto") que agrupa geometricamente o que está dentro dele — mover o retângulo move tudo junto.

## Não-objetivos

- Vínculo explícito de membership (fora do escopo — grupo é puramente geométrico/posicional).
- Nesting de grupos (grupo dentro de grupo).
- Redimensionar o box redimensionando os nós dentro.

## Modelo de dados

Novo type em `ui/src/sessions.ts`, no mesmo padrão de `CanvasWidget`:

```ts
export type GroupBox = {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string; // cor da borda/header
};
```

`SessionSnapshot` ganha campo `groups: GroupBox[]`. Persistido via `PUT /sessions` (mesmo fluxo debounced de 400ms que hoje salva `terminals/widgets/edges/widgetEdges/view` — `AgentCanvas.tsx:375-381`). Backend precisa aceitar/devolver o campo `groups` no snapshot.

## Estado no AgentCanvas

```ts
const [groups, setGroups] = useState<GroupBox[]>([]);
```

## Criação (ferramenta na toolbar)

- Nova entrada em `CanvasTool` (`CanvasToolbar.tsx`): ferramenta "group".
- Ao ativar, próximo mousedown+drag no `.canvas-viewport` desenha um retângulo de preview (coords de mundo via `screenToCanvas`, mesma conversão usada pelo drag de nós).
- Mouseup finaliza: cria `GroupBox` com os bounds desenhados (normalizando x/y/width/height para width/height positivos independente da direção do arrasto). Título default vazio (placeholder "assunto").
- Ferramenta desativa após criar (volta pra modo seleção), igual comportamento esperado de ferramentas de criação únicas.

## Renderização

`<div className="group-box">` absoluto, dentro do `.canvas-world`, renderizado **antes** dos widgets e nós (z-index abaixo — box fica atrás, nunca bloqueia interação com o conteúdo).

Estrutura:
- Retângulo com borda na `color` do grupo, fundo levemente translúcido da mesma cor.
- Header centralizado no topo da borda superior (não ocupando a largura toda) com o título — clique entra em modo edição (input inline), estilo consistente com edição de título de widget existente.
- Alça de resize no canto inferior-direito (reusa `useNodeDrag`'s `startResize`).
- Botão de cor (paleta pequena, mesmas cores já usadas em widgets se existir paleta) e botão de deletar, visíveis no header ou on-hover.

## Drag do grupo (mover tudo junto)

Usa `useNodeDrag` (mesmo hook dos widgets):
- **onDragStart**: snapshot dos ids de nós e widgets cujo rect está **totalmente contido** no rect do box no momento em que o drag começa (não recalcula durante o movimento — comportamento combinado: snapshot, não contínuo). Contido = `node.x >= box.x && node.y >= box.y && node.x+node.width <= box.x+box.width && node.y+node.height <= box.y+box.height` em coords de mundo.
- **onMove**: aplica o mesmo delta (dx, dy) ao próprio box e a cada nó/widget do snapshot (via `moveNode`/equivalente para widgets).
- Resize do box não afeta membership durante o resize — recalcula membership só no próximo drag-start.

## Deletar

Botão de deletar remove só o `GroupBox` do array `groups`. Nós/widgets dentro permanecem intactos no canvas.

## Reuso de utilitários existentes

- `canvasMath.ts`: `screenToCanvas`, `Rect` — usados para desenho e hit-test de contenção.
- `useNodeDrag.ts`: drag e resize do box.
- `allRects` (`AgentCanvas.tsx:105-110`): estender para incluir bounds dos groups (evitar overlap ao criar novos nós, se aplicável).

## Persistência

- `groups` incluído no payload de `saveSessions` (`AgentCanvas.tsx:378`) e lido em `reload()` (`AgentCanvas.tsx:177-215`).
- Backend: endpoint `/sessions` (GET/PUT) precisa aceitar e devolver `groups` no `SessionSnapshot`.

## Testes

- Criar grupo via toolbar → aparece no canvas, persiste após reload.
- Mover grupo com nó totalmente dentro → nó move junto.
- Mover grupo com nó parcialmente fora → nó não se move (não estava contido no snapshot).
- Editar título → persiste.
- Trocar cor → persiste.
- Deletar grupo → nós permanecem, grupo some.
- Resize do grupo → não move nós, só a moldura.
