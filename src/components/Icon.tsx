interface IconProps {
  name:
    | 'transfer'
    | 'help'
    | 'settings'
    | 'folder'
    | 'plus'
    | 'trash'
    | 'close'
    | 'arrow-up-right'
    | 'upload'
    | 'download'
    | 'chevron-down'
    | 'alert'
    | 'check'
    | 'device'
    | 'copy'
    | 'refresh';
  size?: number;
  className?: string;
}

export function Icon({ name, size = 18, className }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
    focusable: false,
  };

  switch (name) {
    case 'transfer':
      return (
        <svg {...common}>
          <path d="M4 7h13m-4-3 3 3-3 3" />
          <path d="M20 17H7m4 3-3-3 3-3" />
        </svg>
      );
    case 'help':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.6 9a2.4 2.4 0 1 1 4 1.8c-.8.7-1.6 1.1-1.6 2.4" />
          <path d="M12 17h.01" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.1" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1v.1h-4v-.1a1.7 1.7 0 0 0-1.4-1.7 1.7 1.7 0 0 0-1.9.3l-.1.1-2.8-2.8.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.7-1.4H2.8v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1v-.1h4v.1a1.7 1.7 0 0 0 1.4 1.7 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9c.2.4.5.8.9 1 .3.2.7.3 1.1.3h.1v4h-.1a1.7 1.7 0 0 0-1.7 1.4Z" />
        </svg>
      );
    case 'folder':
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...common}>
          <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...common}>
          <rect x="8" y="8" width="11" height="11" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case 'arrow-up-right':
      return (
        <svg {...common}>
          <path d="M7 17 17 7M9 7h8v8" />
        </svg>
      );
    case 'download':
      return (
        <svg {...common}>
          <path d="M12 3v12m-5-5 5 5 5-5M5 21h14" />
        </svg>
      );
    case 'upload':
      return (
        <svg {...common}>
          <path d="M12 21V9m-5 5 5-5 5 5M5 3h14" />
        </svg>
      );
    case 'chevron-down':
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...common}>
          <path d="M12 3 2.8 19a1.8 1.8 0 0 0 1.6 2h15.2a1.8 1.8 0 0 0 1.6-2L12 3Z" />
          <path d="M12 9v5M12 17.5h.01" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="m5 12 4.5 4.5L19 7" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 1 0-2.3 5.7" />
          <path d="M20 4v7h-7" />
        </svg>
      );
    case 'device':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      );
  }
}
