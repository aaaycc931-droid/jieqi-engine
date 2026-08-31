export class RuleError extends Error {
           code        ;

  constructor(code        , message        ) {
    super(message);
    this.name = "RuleError";
    this.code = code;
  }
}
