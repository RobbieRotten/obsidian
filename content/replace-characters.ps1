Get-ChildItem -Path "D:\Files\UTS Law\Quartz\quartz\content" -Filter *.md -Recurse |
ForEach-Object {
    (Get-Content $_.FullName) -replace '‘', '''' `
                             -replace '’', '''' `
                             -replace '“', '"' `
                             -replace '”', '"' | 
    Set-Content $_.FullName
}
