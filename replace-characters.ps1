Get-ChildItem -Path "D:\Files\Quartz\quartz\content" -Filter *.md -Recurse |
ForEach-Object {
    (Get-Content $_.FullName) -replace '‘', '''' `
                             -replace '’', '''' `
                             -replace '“', '"' `
                             -replace '”', '"' | 
    Set-Content $_.FullName
}
