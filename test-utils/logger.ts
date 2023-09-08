export class Logger {
  logSingleLevelIndent: string;
  logIndent: string;
  logEnabled: boolean;
  readonly startTime: Date;
  readonly startTimeFormatted: string;

  constructor(logSingleLevelIndent: string) {
    this.logSingleLevelIndent = logSingleLevelIndent;
    this.logIndent = "";
    this.logEnabled = true;
    this.startTime = new Date(Date.now());
    this.startTimeFormatted = Logger.formatDate(this.startTime);
  }

  increaseLogIndent(numberOfSteps: number = 1) {
    this.logIndent += this.logSingleLevelIndent.repeat(numberOfSteps);
  }

  decreaseLogIndent(numberOfSteps: number = 1) {
    while (numberOfSteps-- > 0) {
      const endIndex = this.logIndent.lastIndexOf(this.logSingleLevelIndent);
      if (endIndex >= 0) {
        this.logIndent = this.logIndent.substring(0, endIndex);
      }
    }
  }

  log(message: string, ...values: any[]) {
    if (!this.logEnabled) {
      return;
    }
    const date = new Date(Date.now());
    const formattedDate = Logger.formatDate(date);
    console.log(formattedDate + " " + this.logIndent + message, ...values);
  }

  logEmptyLine() {
    if (!this.logEnabled) {
      return;
    }
    console.log("");
  }

  enable() {
    this.logEnabled = true;
  }

  disable() {
    this.logEnabled = false;
  }

  previewLogWithTimeSpace(message: string, ...values: any[]): string {
    let result = " ".repeat(this.startTimeFormatted.length) + " " + this.logIndent + message;
    if (values.length > 0) {
      result += "";
      for (let i = 0; i < values.length - 1; ++i) {
        result += values[i].toString() + " ";
      }
      result += values[values.length - 1].toString();
    }
    return result;
  }

  getLogIndentWithTimeSpace(): string {
    return " ".repeat(this.startTimeFormatted.length) + " " + this.logIndent;
  }

  static formatDate(date: Date): string {
    return (
      date.getFullYear().toString().padStart(4, "0") + "-" +
      (date.getMonth() + 1).toString().padStart(2, "0") + "-" +
      date.getDate().toString().padStart(2, "0") + " " +
      date.getHours().toString().padStart(2, "0") + ":" +
      date.getMinutes().toString().padStart(2, "0") + ":" +
      date.getSeconds().toString().padStart(2, "0") + "." +
      date.getMilliseconds().toString().padStart(3, "0")
    );
  }
}