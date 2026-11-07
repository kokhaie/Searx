export type TimeRange = '' | 'day' | 'week' | 'month' | 'year'

export interface SearchResultItem {
  title: string
  url: string
  snippet: string
  publishedDate?: string
  engine?: string
}

export interface SearchApiResponse {
  query: string
  results: SearchResultItem[]
  suggestions: string[]
  rawCount: number
  filteredCount: number
  timings: {
    searx: number
    ai: number
  }
}

export interface SuggestApiResponse {
  suggestions: string[]
}

export interface TextSegment {
  text: string
  match: boolean
}
