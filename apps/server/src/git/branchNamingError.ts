import { Schema } from "effect";
export class BranchNamingError extends Schema.TaggedError<BranchNamingError>()(
  "BranchNamingError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}
export const branchNamingError = (detail: string) => new BranchNamingError({ detail });
