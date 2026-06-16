export interface AgentRatingStats {
  totalRatings: number;
  averageRating: number;
}

export interface UserAgentRatingWithUser {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    name: string;
    image: string | null;
  };
}
