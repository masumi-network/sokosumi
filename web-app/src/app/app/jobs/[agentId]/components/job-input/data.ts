import {
  JobInputSchemaType,
  ValidJobInputTypes,
  ValidJobInputValidationTypes,
} from "@/lib/job-input";

export const dummyInputData: JobInputSchemaType[] = [
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
        validation: ValidJobInputValidationTypes.OPTIONAL,
        value: "true",
      },
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
        validation: ValidJobInputValidationTypes.OPTIONAL,
        value: "true",
      },
      {
        validation: ValidJobInputValidationTypes.MIN,
        value: 5,
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
