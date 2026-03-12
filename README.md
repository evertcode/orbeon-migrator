# Orbeon Forms - Action Syntax Migrator

CLI interactiva para migrar **Simple Actions** al nuevo **Action Syntax** de Orbeon 2025.1+.

Usa el patrón probado: `fr:service-call` → `fr:dataset-write` → `fr:dataset()`
(en lugar de `fr:service-result()` que puede no funcionar en todas las versiones).

## Instalación

```bash
npm install
```

## Uso

### CLI Interactiva

```bash
npm start
# o
node src/index.js
```

La CLI te guiará paso a paso:
1. Selecciona el archivo XML del formulario Orbeon
2. Revisa las acciones detectadas
3. Elige cuáles migrar
4. Revisa el XML generado y el reporte de validación
5. Guarda el snippet, el form completo migrado, o el reporte

### Test

```bash
npm test
```

Ejecuta la migración sobre un XML de ejemplo para verificar que todo funciona.

## ¿Qué migra?

| Simple Action | Action Syntax |
|---|---|
| `DOMActivate` en botón | `fr:listener events="activated"` |
| `xf:send submission="..."` | `fr:service-call service="..."` |
| `fr-set-service-value-action` | `fr:value` dentro de `fr:service-call` |
| `fr-set-control-value-action` | `fr:control-setvalue` |
| `fr-set-control-visibility-action` | `fr:control-setvisible` |
| `fr-set-control-readonly-action` | `fr:control-setreadonly` |
| `fr-itemset-action` | `fr:control-setitems` |
| `saxon:serialize(., 'xml')` | `saxon:serialize(fr:dataset('...'), 'xml')` |

## Patrón de respuesta

En lugar de `fr:service-result()`, se usa el patrón de dataset:

```xml
<!-- 1. Llamar servicio -->
<fr:service-call service="mi-servicio">
    <fr:value control="mi-control" ref="//campo"/>
</fr:service-call>

<!-- 2. Guardar respuesta -->
<fr:dataset-write name="mi-servicio-response"/>

<!-- 3. Leer del dataset -->
<fr:control-setvalue
    control="resultado"
    value="fr:dataset('mi-servicio-response')//dato"/>
```

## Después de migrar

1. **Elimina** los bloques `<xf:action id="...-binding">` viejos
2. **Conserva** los `<xf:instance>` y `<xf:submission>` de los servicios
3. **Coloca** el nuevo XML dentro de `<xf:model id="fr-form-model">`
4. **Prueba** en Form Builder → Test

## Estructura

```
src/
  index.js      # CLI interactiva principal
  parser.js     # Extrae Simple Actions del XML
  generator.js  # Genera Action Syntax XML
  validator.js  # Valida la migración
  test.js       # Test con XML de ejemplo
```

## Autor

[@evertcode](https://github.com/evertcode)
