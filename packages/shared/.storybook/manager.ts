import { addons } from 'storybook/manager-api'
import { create } from 'storybook/theming/create'

const edisonTheme = create({
  base: 'dark',
  brandTitle: 'Edison Watch',
  brandUrl: '/',

  // Dark navy backgrounds
  appBg: '#0B0E14',
  appContentBg: '#141820',
  appBorderColor: '#1E2432',
  appBorderRadius: 8,

  // Cyan accent
  colorPrimary: '#7DFFF6',
  colorSecondary: '#5CC8C0',

  // Text
  textColor: '#E8ECF2',
  textMutedColor: '#8B95A8',
  textInverseColor: '#0B0E14',

  // Toolbar
  barTextColor: '#8B95A8',
  barSelectedColor: '#7DFFF6',
  barBg: '#141820',
  barHoverColor: '#E8ECF2',

  // Form
  inputBg: '#0F1219',
  inputBorder: '#1E2432',
  inputTextColor: '#E8ECF2',
  inputBorderRadius: 6,

  // Booleans
  booleanBg: '#0F1219',
  booleanSelectedBg: '#2A4A48'
})

addons.setConfig({ theme: edisonTheme })
