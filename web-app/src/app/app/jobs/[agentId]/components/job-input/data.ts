import {
  JobInputSchemaType,
  ValidJobInputFormatValues,
  ValidJobInputTypes,
  ValidJobInputValidationTypes,
} from "@/lib/job-input";

export const dummyInputData: JobInputSchemaType[] = [
  {
    id: "text",
    name: "Hello Text",
    type: ValidJobInputTypes.NONE,
    data: {
      description: "Please Input fields to start job",
    },
  },
  {
    id: "reference-company",
    name: "Reference Company",
    type: ValidJobInputTypes.STRING,
    data: {
      placeholder: "Enter the reference company",
      description: "Which company should serve as basis",
    },
    validations: [
      {
        validation: ValidJobInputValidationTypes.MIN,
        value: 5,
      },
    ],
  },
  {
    id: "target-company",
    name: "Target Company",
    type: ValidJobInputTypes.STRING,
    data: {
      placeholder: "Enter the target company",
      description: "Which company should serve as target",
    },
    validations: [
      {
        validation: ValidJobInputValidationTypes.MIN,
        value: 5,
      },
    ],
  },
  {
    id: "timeout",
    name: "Timeout",
    type: ValidJobInputTypes.NUMBER,
    data: {
      placeholder: "Enter the timeout",
      description: "Timeout in seconds",
    },
    validations: [
      {
        validation: ValidJobInputValidationTypes.FORMAT,
        value: ValidJobInputFormatValues.INTEGER,
      },
    ],
  },
  {
    id: "fast-check",
    name: "Fast Check",
    type: ValidJobInputTypes.BOOLEAN,
    data: {
      placeholder: "Fast check",
      description: "Fast check",
    },
    validations: [
      {
        validation: ValidJobInputValidationTypes.OPTIONAL,
        value: "true",
      },
    ],
  },
];
