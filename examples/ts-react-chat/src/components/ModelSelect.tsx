import { ChevronDown } from 'lucide-react'
import { CHAT_MODEL_GROUPS, CHAT_MODEL_OPTIONS, chatModelApi } from '@/lib/models'
import type { ChatModelOption } from '@/lib/models'

const SELECT_CLASSNAME =
  'w-full appearance-none rounded-lg border border-orange-500/20 bg-gray-900 pl-3 pr-8 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 disabled:opacity-50'

/**
 * Native <select> with the OS chrome stripped (appearance-none) and a chevron
 * matching the app theme. The open popup stays fully native — keyboard nav,
 * screen readers, and the mobile picker come for free.
 */
function SelectShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    </div>
  )
}

interface ChatModelSelectProps {
  value: ChatModelOption
  onChange: (option: ChatModelOption) => void
  disabled?: boolean
  className?: string
}

/**
 * The one chat-model selector. Options come from `CHAT_MODEL_GROUPS` in
 * `lib/models.ts`, grouped per provider; the selection round-trips through
 * `CHAT_MODEL_OPTIONS` indices so the chosen entry keeps its literal
 * provider/model types.
 */
export function ChatModelSelect({
  value,
  onChange,
  disabled,
  className,
}: ChatModelSelectProps) {
  // Match on provider + model + api flavor: the same model id can appear
  // twice under one provider (e.g. gpt-5.2 Responses vs Chat Completions,
  // gemini-3.1-pro-preview stateless vs Interactions).
  const selectedIndex = CHAT_MODEL_OPTIONS.findIndex(
    (option) =>
      option.provider === value.provider &&
      option.model === value.model &&
      chatModelApi(option) === chatModelApi(value),
  )

  let optionIndex = -1

  return (
    <SelectShell>
      <select
        value={selectedIndex}
        onChange={(event) => {
          const option = CHAT_MODEL_OPTIONS[Number(event.target.value)]
          if (option) onChange(option)
        }}
        disabled={disabled}
        className={className ?? SELECT_CLASSNAME}
      >
        {CHAT_MODEL_GROUPS.map((group) => (
          <optgroup key={group.provider} label={group.label}>
            {group.models.map((option) => {
              optionIndex += 1
              return (
                <option
                  key={`${group.provider}:${option.model}:${chatModelApi(option) ?? 'default'}`}
                  value={optionIndex}
                >
                  {option.label}
                </option>
              )
            })}
          </optgroup>
        ))}
      </select>
    </SelectShell>
  )
}

interface GroupedModelSelectProps<ModelId extends string> {
  /** Groups of `{ id, name }` models — typically `IMAGE_MODEL_GROUPS` / `VIDEO_MODEL_GROUPS` (optionally pre-filtered). */
  groups: ReadonlyArray<{
    label: string
    models: ReadonlyArray<{ id: ModelId; name: string }>
  }>
  value: ModelId | 'all'
  onChange: (value: ModelId | 'all') => void
  includeAll?: boolean
  disabled?: boolean
  className?: string
}

/**
 * Grouped media-model selector for the generation pages. The generic keeps
 * `value`/`onChange` typed as the model-id literal union (plus `'all'`), so
 * pages never handle models as plain strings.
 */
export function GroupedModelSelect<ModelId extends string>({
  groups,
  value,
  onChange,
  includeAll,
  disabled,
  className,
}: GroupedModelSelectProps<ModelId>) {
  return (
    <SelectShell>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ModelId | 'all')}
        disabled={disabled}
        className={className ?? SELECT_CLASSNAME}
      >
        {includeAll && <option value="all">All Models</option>}
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </SelectShell>
  )
}
