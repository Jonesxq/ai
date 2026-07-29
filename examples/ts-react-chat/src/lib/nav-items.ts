import {
  Activity,
  BadgeCheck,
  Braces,
  Code2,
  Database,
  FileAudio,
  FileText,
  Guitar,
  Image,
  Layers,
  LayoutGrid,
  MessageSquare,
  Mic,
  Music,
  PauseCircle,
  Plug,
  RefreshCw,
  Server,
  Sparkles,
  Video,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Single source of truth for app navigation: the Header's slide-out menu and
 * the home screen's tiles both render from these sections, so a page appears
 * in both places (or neither) by editing one list.
 */
export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export interface NavSection {
  label: string
  items: Array<NavItem>
}

export const NAV_SECTIONS: Array<NavSection> = [
  {
    label: 'Chat',
    items: [{ to: '/chat', label: 'Basic Chat', icon: MessageSquare }],
  },
  {
    label: 'Generations',
    items: [
      { to: '/generation-hooks', label: 'Generation Hooks', icon: Activity },
      { to: '/generations/image', label: 'Image Generation', icon: Image },
      { to: '/generations/speech', label: 'Text-to-Speech', icon: FileAudio },
      { to: '/generations/audio', label: 'Audio Generation', icon: Music },
      {
        to: '/generations/transcription',
        label: 'Transcription',
        icon: Mic,
      },
      { to: '/generations/summarize', label: 'Summarization', icon: FileText },
      { to: '/generations/video', label: 'Video Generation', icon: Video },
      {
        to: '/generations/structured-output',
        label: 'Structured Output',
        icon: Braces,
      },
      {
        to: '/generations/structured-chat',
        label: 'Structured Chat',
        icon: Braces,
      },
    ],
  },
  {
    label: 'Examples',
    items: [
      { to: '/example/guitars', label: 'Guitar Demo', icon: Guitar },
      { to: '/typesafe-tools', label: 'Type-Safe Tools', icon: Code2 },
      { to: '/threads', label: 'Persistent Chats', icon: MessageSquare },
      { to: '/queueing', label: 'Queueing Strategies', icon: Layers },
      {
        to: '/example/runtime-context',
        label: 'Runtime Context',
        icon: BadgeCheck,
      },
      { to: '/realtime', label: 'Voice Chat (Realtime)', icon: Mic },
      { to: '/server-fn-chat', label: 'Server Function Chat', icon: Server },
      { to: '/resumable', label: 'Resumable Streams', icon: RefreshCw },
      { to: '/persistent-chat', label: 'Persistent Chat', icon: Database },
      { to: '/interrupts', label: 'Interrupts Lab', icon: PauseCircle },
      { to: '/mcp-demo', label: 'MCP Servers', icon: Plug },
      { to: '/mcp-apps', label: 'MCP Apps', icon: LayoutGrid },
      {
        to: '/capability-demo',
        label: 'Capability Middleware',
        icon: Sparkles,
      },
    ],
  },
]
