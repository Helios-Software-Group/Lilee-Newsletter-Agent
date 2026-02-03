// Meeting categories for newsletter organization
export type MeetingBucket = 'Customer' | 'Pipeline' | 'Internal';

export interface Meeting {
  id: string;
  url: string;
  name: string;
  bucket: MeetingBucket;
  date: string;
  summary?: string;
  highlights?: string[];
}

export interface MeetingWithContent extends Meeting {
  fullContent: string;
  actionItems?: string[];
  keyQuotes?: string[];
}

// Newsletter structure
export interface NewsletterDraft {
  id?: string;
  url?: string;
  title: string;
  date: string;
  status: 'Draft' | 'Ready' | 'Ready to Send' | 'Sent';
  audience: 'Customers' | 'Internal';
  highlights: string;
  primaryCustomer?: string;
  content: string;
}

export interface BigFeature {
  area: string;
  operationalBenefit: string;
  whatShipped: string[];
  whyItMatters: string;
  operationalImpact: string[];
  complianceAngle?: string;
}

export interface NewsletterContent {
  features: BigFeature[];
  roadmap: RoadmapItem[];
  customerFeedback: CustomerFeedback[];
  oneAsk: string;
}

export interface RoadmapItem {
  initiative: string;
  status: string;
  nextMilestone: string;
  regulatoryAlignment: string;
}

export interface CustomerFeedback {
  source: string;
  date: string;
  quote: string;
  whatResonated: string[];
  whatWeFixing?: string[];
}

// Slack notification payload
export interface SlackMessage {
  draftUrl: string;
  issueDate: string;
  questions: string[];
  suggestedCollateral: string[];
}

// Loops email payload
export interface LoopsEmailPayload {
  transactionalId: string;
  email: string;
  dataVariables: {
    issue_title: string;
    content_html: string;
    video_link?: string;
    unsubscribe_link: string;
  };
}

// CRM Entry from Customer Database
export type CRMStatus = 'Lead' | 'Discovery' | 'Qualified' | 'Proposal' | 'Negotiation' | 'In progress' | 'Closed' | 'Lost';

export interface CRMEntry {
  id: string;
  url: string;
  name: string;
  company: string;
  email?: string;
  phone?: string;
  status: CRMStatus;
  priority?: string;
  estimatedValue?: number;
  accountOwner?: string;
  lastContact?: string;
  expectedClose?: string;
}
