export interface AppInfo {
  currentUser?: {
    id: string;
    email: string;
    role: string;
    name: string | null;
    ldapId: string | null;
  };
  config: {
    allowCsvDownload: boolean;
    baseUrl: string;
    defaultConnectionId: string | null;
    editorWordWrap: boolean;
    googleAuthConfigured: boolean;
    localAuthConfigured: boolean;
    publicUrl: string;
    samlConfigured: boolean;
    samlLinkHtml: string | null;
    ldapConfigured: boolean;
    ldapRolesConfigured: boolean;
    oidcConfigured: boolean;
    oidcLinkHtml: string | null;
    showServiceTokensUI: boolean;
  };
  version: string;
}

export interface Connection {
  id: string;
  name: string;
  description: string | null;
  driver: string;
  multiStatementTransactionEnabled: boolean | null;
  idleTimeoutSeconds: number | null;
  data?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  editable?: boolean;
  maxRows: number;
  supportsConnectionClient: boolean;
  isAsynchronous: boolean;
  [driverField: string]: unknown;
}

export interface Driver {
  id: string;
  name: string;
  fields: Array<{
    key: string;
    formType: string;
    label: string;
    description?: string;
    placeholder?: string;
    [option: string]: unknown;
  }>;
  supportsConnectionClient: boolean;
}

export interface SavedQuery {
  id: string;
  name: string;
  connectionId: string | null;
  queryText: string | null;
  chart: Record<string, unknown> | null;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  acl?: Array<{
    id?: string;
    queryId?: string;
    userId?: string | null;
    userEmail?: string | null;
    groupId?: string | null;
    write?: boolean;
    [field: string]: unknown;
  }>;
  createdByUser?: SqlPadUser;
  updatedByUser?: SqlPadUser;
}

interface SqlPadUser {
  id: string;
  name: string | null;
  email: string;
}

export interface Batch {
  id: string;
  queryId: string | null;
  name: string | null;
  connectionId: string;
  connectionClientId: string | null;
  status: string;
  startTime: string;
  stopTime: string | null;
  durationMs: number | null;
  batchText: string;
  selectedText: string | null;
  chart: Record<string, unknown> | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
  statements?: Statement[];
}

export interface StatementColumn {
  name: string;
  datatype: 'date' | 'datetime' | 'number' | 'string' | 'boolean' | 'object';
  min: unknown;
  max: unknown;
  maxValueLength: number;
  maxLineLength: number;
}

export interface Statement {
  id: string;
  batchId: string;
  sequence: number;
  statementText: string;
  status: string;
  startTime: string | null;
  stopTime: string | null;
  durationMs: number | null;
  rowCount: number | null;
  resultsPath: string | null;
  columns: StatementColumn[] | null;
  error: { title?: string; detail?: string } | null;
  incomplete?: boolean | null;
  createdAt?: string;
  updatedAt?: string;
  executionId?: string | null;
}

export interface ConnectionSchemaColumn {
  name: string;
  description?: string | null;
  dataType: string;
}

export interface ConnectionSchemaTable {
  name: string;
  description?: string | null;
  columns: ConnectionSchemaColumn[];
}

export type ConnectionSchema =
  | {
      schemas: Array<{
        name: string;
        description?: string | null;
        tables: ConnectionSchemaTable[];
      }>;
      tables?: never;
    }
  | { tables: ConnectionSchemaTable[]; schemas?: never }
  | { schemas?: never; tables?: never };
