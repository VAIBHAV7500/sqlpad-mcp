import { z } from 'zod'

export interface SqlPadConfig {
  baseUrl: string
  serviceToken: string
  allowWrites: boolean
  allowAdmin: boolean
  maxRows: number
  timeoutMs: number
  pollIntervalMs: number
}

type ConfigInput = {
  baseUrl?: string
  serviceToken?: string
  allowWrites?: string | boolean
  allowAdmin?: string | boolean
  maxRows?: string
  timeoutMs?: string
}

const booleanValue = z.preprocess((value) => {
  if (typeof value !== 'string') return value

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return value
}, z.boolean())

const positiveInteger = z.coerce.number().int().positive()

const configSchema = z.object({
  baseUrl: z.string({ required_error: 'SQLPad base URL is required. Set SQLPAD_BASE_URL or pass --base-url.' })
    .trim()
    .min(1, 'SQLPad base URL is required. Set SQLPAD_BASE_URL or pass --base-url.')
    .refine((value) => {
      try {
        const protocol = new URL(value).protocol
        return protocol === 'http:' || protocol === 'https:'
      } catch {
        return false
      }
    }, 'SQLPad base URL must be a valid http:// or https:// URL.')
    .transform((value) => value.replace(/\/+$/, '')),
  serviceToken: z.string({ required_error: 'SQLPad service token is required. Set SQLPAD_SERVICE_TOKEN or pass --token.' })
    .refine(
      (value) => value.trim().length > 0,
      'SQLPad service token is required. Set SQLPAD_SERVICE_TOKEN or pass --token.',
    ),
  allowWrites: booleanValue.default(false),
  allowAdmin: booleanValue.default(false),
  maxRows: positiveInteger.default(500),
  timeoutMs: positiveInteger.default(60_000),
  pollIntervalMs: z.number().int().positive().default(250),
})

const flagToKey = {
  '--base-url': 'baseUrl',
  '--token': 'serviceToken',
  '--max-rows': 'maxRows',
  '--timeout-ms': 'timeoutMs',
} as const

const booleanFlagToKey = {
  '--allow-writes': 'allowWrites',
  '--allow-admin': 'allowAdmin',
} as const

function readCli(argv: string[]): ConfigInput {
  const input: ConfigInput = {}

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const separatorIndex = argument.indexOf('=')
    const flag = separatorIndex === -1 ? argument : argument.slice(0, separatorIndex)
    const inlineValue = separatorIndex === -1 ? undefined : argument.slice(separatorIndex + 1)

    if (flag in booleanFlagToKey) {
      const key = booleanFlagToKey[flag as keyof typeof booleanFlagToKey]
      input[key] = inlineValue ?? true
      continue
    }

    if (!(flag in flagToKey)) {
      throw new Error('Unsupported command-line argument.')
    }

    const key = flagToKey[flag as keyof typeof flagToKey]
    const value = inlineValue ?? argv[index + 1]
    if (value === undefined || (inlineValue === undefined && value.startsWith('--'))) {
      throw new Error(`Missing value for ${flag}.`)
    }

    input[key] = value
    if (inlineValue === undefined) index += 1
  }

  return input
}

function formatValidationError(error: z.ZodError): string {
  return error.issues.map((issue) => {
    const field = issue.path[0]
    if (field === 'serviceToken') {
      if (issue.code === z.ZodIssueCode.invalid_type) {
        return 'SQLPad service token is required. Set SQLPAD_SERVICE_TOKEN or pass --token.'
      }
      return 'SQLPad service token is invalid. Set a non-empty SQLPAD_SERVICE_TOKEN or pass --token.'
    }
    if (field === 'maxRows') return 'SQLPad max rows must be a positive integer.'
    if (field === 'timeoutMs') return 'SQLPad timeout must be a positive integer in milliseconds.'
    if (field === 'allowWrites') return 'SQLPAD_ALLOW_WRITES must be true or false.'
    if (field === 'allowAdmin') return 'SQLPAD_ALLOW_ADMIN must be true or false.'
    return issue.message
  }).join(' ')
}

export function loadConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): SqlPadConfig {
  const cli = readCli(argv)
  const input: ConfigInput = {
    baseUrl: cli.baseUrl ?? env.SQLPAD_BASE_URL,
    serviceToken: cli.serviceToken ?? env.SQLPAD_SERVICE_TOKEN,
    maxRows: cli.maxRows ?? env.SQLPAD_MAX_ROWS,
    timeoutMs: cli.timeoutMs ?? env.SQLPAD_TIMEOUT_MS,
    allowWrites: cli.allowWrites ?? env.SQLPAD_ALLOW_WRITES,
    allowAdmin: cli.allowAdmin ?? env.SQLPAD_ALLOW_ADMIN,
  }

  const result = configSchema.safeParse(input)
  if (!result.success) {
    throw new Error(`Invalid SQLPad configuration: ${formatValidationError(result.error)}`)
  }

  return result.data
}
