/**
 * XML builder for Trafikinfo API requests
 *
 * The Trafikinfo API uses XML POST requests with a specific structure:
 * <REQUEST>
 *   <LOGIN authenticationkey="API_KEY" />
 *   <QUERY objecttype="..." schemaversion="..." limit="...">
 *     <FILTER>
 *       <EQ name="..." value="..." />
 *       <WITHIN name="Geometry.WGS84" shape="center" value="lon lat" radius="10000m" />
 *     </FILTER>
 *     <INCLUDE>FieldName</INCLUDE>
 *   </QUERY>
 * </REQUEST>
 */

export interface XmlFilter {
  type: 'EQ' | 'NE' | 'GT' | 'LT' | 'GTE' | 'LTE' | 'LIKE' | 'IN' | 'WITHIN' | 'EXISTS' | 'OR' | 'AND';
  name?: string;
  value?: string | number | boolean;
  // For WITHIN filter
  shape?: 'center' | 'box';
  radius?: string;
  // For OR/AND compound filters
  children?: XmlFilter[];
}

export interface XmlQuery {
  objectType: string;
  schemaVersion: string;
  limit?: number;
  filters?: XmlFilter[];
  includes?: string[];
  orderBy?: string;
  lastModified?: boolean;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function buildFilter(filter: XmlFilter): string {
  if (filter.type === 'OR' || filter.type === 'AND') {
    if (!filter.children || filter.children.length === 0) return '';
    const children = filter.children.map(buildFilter).join('');
    return `<${filter.type}>${children}</${filter.type}>`;
  }

  if (filter.type === 'WITHIN') {
    return `<WITHIN name="${escapeXml(filter.name || '')}" shape="${filter.shape || 'center'}" value="${escapeXml(String(filter.value))}" radius="${filter.radius || '10000m'}" />`;
  }

  if (filter.type === 'EXISTS') {
    return `<EXISTS name="${escapeXml(filter.name || '')}" value="${filter.value ? 'true' : 'false'}" />`;
  }

  if (filter.type === 'IN') {
    // IN filter expects comma-separated values
    return `<IN name="${escapeXml(filter.name || '')}" value="${escapeXml(String(filter.value))}" />`;
  }

  // Standard comparison filters
  return `<${filter.type} name="${escapeXml(filter.name || '')}" value="${escapeXml(String(filter.value))}" />`;
}

/**
 * Build an XML request for the Trafikinfo API
 */
export function buildTrafikinfoRequest(apiKey: string, queries: XmlQuery[]): string {
  const queryXml = queries
    .map((q) => {
      const filterXml = q.filters && q.filters.length > 0 ? `<FILTER>${q.filters.map(buildFilter).join('')}</FILTER>` : '';

      const includesXml = q.includes ? q.includes.map((field) => `<INCLUDE>${escapeXml(field)}</INCLUDE>`).join('') : '';

      const orderByAttr = q.orderBy ? ` orderby="${escapeXml(q.orderBy)}"` : '';
      const lastModifiedAttr = q.lastModified ? ' lastmodified="true"' : '';
      const limitAttr = q.limit ? ` limit="${q.limit}"` : '';

      return `<QUERY objecttype="${escapeXml(q.objectType)}" schemaversion="${escapeXml(q.schemaVersion)}"${limitAttr}${orderByAttr}${lastModifiedAttr}>${filterXml}${includesXml}</QUERY>`;
    })
    .join('');

  return `<REQUEST><LOGIN authenticationkey="${escapeXml(apiKey)}" />${queryXml}</REQUEST>`;
}

/**
 * Build a WITHIN filter for geographic queries
 */
export function withinFilter(longitude: number, latitude: number, radiusKm: number): XmlFilter {
  return {
    type: 'WITHIN',
    name: 'Geometry.WGS84',
    shape: 'center',
    value: `${longitude} ${latitude}`,
    radius: `${radiusKm * 1000}m`,
  };
}

/**
 * Build an EQ filter for exact match
 */
export function eqFilter(name: string, value: string | number | boolean): XmlFilter {
  return { type: 'EQ', name, value };
}

/**
 * Build a LIKE filter for partial match (regex-based)
 *
 * The Trafikinfo API LIKE filter uses regex patterns, not glob syntax.
 * This function accepts glob-style wildcards (*) for convenience and
 * converts them to proper regex (.*).
 *
 * Examples:
 *   *182* → .*182.*  (matches "Track 182 North")
 *   E4*   → E4.*     (matches "E4", "E4.1", "E4-South")
 *   *holm → .*holm   (matches "Stockholm")
 */
export function likeFilter(name: string, pattern: string): XmlFilter {
  // Convert glob wildcards to regex: * → .*
  // Handle multiple wildcards and edge cases
  const regexPattern = pattern.replace(/\*/g, '.*');
  return { type: 'LIKE', name, value: regexPattern };
}

/**
 * Build an OR filter combining multiple conditions
 */
export function orFilter(...children: XmlFilter[]): XmlFilter {
  return { type: 'OR', children };
}

/**
 * Build an AND filter combining multiple conditions
 */
export function andFilter(...children: XmlFilter[]): XmlFilter {
  return { type: 'AND', children };
}
